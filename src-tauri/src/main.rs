#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{window::Monitor, Emitter, Manager, State, WebviewWindow};
mod about;
#[cfg(target_os = "windows")]
mod fullscreen;
mod i18n;
#[cfg(target_os = "windows")]
mod monitor;
mod settings;
#[cfg(target_os = "windows")]
mod startup;
mod tray;

const MIN_ZOOM_PERCENT: u16 = 70;
const MAX_ZOOM_PERCENT: u16 = 150;
const ZOOM_STEP_PERCENT: usize = 10;
const FULLSCREEN_EVENT: &str = "camp-fullscreen";
const WINDOW_PLACEMENT_FILE: &str = "window-placement.json";

fn validate_zoom(window: &WebviewWindow, zoom: f64) -> Result<(), String> {
    let percent = zoom * 100.0;
    if !zoom.is_finite()
        || !(MIN_ZOOM_PERCENT as f64..=MAX_ZOOM_PERCENT as f64).contains(&percent)
        || (percent - percent.round()).abs() > 1e-8
        || percent.round() as usize % ZOOM_STEP_PERCENT != 0
    {
        return Err(i18n::current(window.app_handle()).text("zoomRange").into());
    }
    Ok(())
}

struct HitState {
    rows: Mutex<Vec<Vec<[u16; 2]>>>,
    mask_revision: AtomicU64,
    ignoring: AtomicBool,
    ready: AtomicBool,
    pinned: AtomicBool,
    fullscreen_active: AtomicBool,
    yielding_fullscreen: AtomicBool,
    passthrough: AtomicBool,
    zoom: AtomicU64,
    scene_bottom: AtomicU64,
    ground_baseline: AtomicU64,
    docked: AtomicBool,
    dragging: AtomicBool,
    pending_placement: Mutex<Option<WindowPlacement>>,
}

#[derive(Deserialize, Serialize)]
struct WindowPlacement {
    monitor: String,
    x: f64,
    y: f64,
    docked: bool,
}

impl WindowPlacement {
    fn read(window: &WebviewWindow) -> Option<Self> {
        settings::read(window, WINDOW_PLACEMENT_FILE)
    }

    fn save(&self, window: &WebviewWindow) -> Result<(), String> {
        settings::save(window, WINDOW_PLACEMENT_FILE, self).map_err(|error| {
            format!("{} {error}", i18n::current(window.app_handle()).text("savePlacementFailed"))
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    width: f64,
    height: f64,
    scale_factor: f64,
    always_on_top: bool,
    fullscreen_active: bool,
    ignoring_cursor: bool,
    visible: bool,
    ready: bool,
    passthrough: bool,
    physical_x: i32,
    physical_y: i32,
    zoom: f64,
    scene_bottom: f64,
    ground_baseline: f64,
    docked: bool,
    work_area_bottom_physical: i32,
    taskbar_height_physical: u32,
    hit_mask_revision: u64,
}

fn resize_scene(window: &WebviewWindow, state: &HitState, zoom: f64, scale: f64) -> Result<(), String> {
    let bottom = f64::from_bits(state.scene_bottom.load(Ordering::Relaxed));
    // Match the clipped ground edge and its physical-pixel rounding exactly.
    window
        .set_size(tauri::PhysicalSize::new(
            (500.0 * zoom * scale).round() as u32,
            (bottom * zoom * scale).round() as u32,
        ))
        .map_err(|e| e.to_string())
}

fn ground_offset(window: &WebviewWindow, state: &HitState) -> Result<i32, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    Ok(scaled_ground_offset(state, scale))
}

fn scaled_ground_offset(state: &HitState, scale: f64) -> i32 {
    let baseline = f64::from_bits(state.ground_baseline.load(Ordering::Relaxed));
    let zoom = f64::from_bits(state.zoom.load(Ordering::Relaxed));
    (baseline * zoom * scale).round() as i32
}

fn dock_to_taskbar(window: &WebviewWindow, state: &HitState) -> Result<(), String> {
    if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
        let work = monitor.work_area();
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let x = position.x.clamp(
            work.position.x,
            work.position.x + (work.size.width as i32 - size.width as i32).max(0),
        );
        let y = work.position.y + (work.size.height as i32 - ground_offset(window, state)?).max(0);
        let docked = tauri::PhysicalPosition::new(x, y);
        if position != docked {
            window.set_position(docked).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn window_placement(window: &WebviewWindow, state: &HitState) -> Option<WindowPlacement> {
    let monitor = window.current_monitor().ok()??;
    let origin = monitor.work_area().position;
    let position = window.outer_position().ok()?;
    let scale = monitor.scale_factor();
    Some(WindowPlacement {
        monitor: monitor_identifier(&monitor)?,
        x: f64::from(position.x - origin.x) / scale,
        y: f64::from(position.y - origin.y) / scale,
        docked: state.docked.load(Ordering::Relaxed),
    })
}

#[tauri::command]
fn begin_drag(state: State<'_, Arc<HitState>>) -> Result<(), String> {
    let mut pending = state.pending_placement.lock().map_err(|e| e.to_string())?;
    state.dragging.store(true, Ordering::Relaxed);
    state.docked.store(false, Ordering::Relaxed);
    *pending = None;
    Ok(())
}

#[tauri::command]
fn finish_drag(
    window: WebviewWindow,
    state: State<'_, Arc<HitState>>,
) -> Result<(), String> {
    state.dragging.store(false, Ordering::Relaxed);
    if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
        let work = monitor.work_area();
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let threshold = (24.0 * monitor.scale_factor()).round() as i32;
        let near_bottom = position.y + ground_offset(&window, &state)?
            >= work.position.y + work.size.height as i32 - threshold;
        if near_bottom {
            dock_to_taskbar(&window, &state)?;
        }
        state.docked.store(near_bottom, Ordering::Relaxed);
    }
    if let Some(placement) = window_placement(&window, &state) {
        placement.save(&window)?;
    }
    Ok(())
}

fn replace_mask(state: &HitState, rows: Vec<Vec<[u16; 2]>>) -> Result<(), String> {
    if rows.len() != 300
        || rows
            .iter()
            .any(|row| row.len() > 250 || row.iter().any(|r| r[0] >= r[1] || r[1] > 500))
    {
        return Err("Invalid hit mask".into());
    }
    *state.rows.lock().map_err(|e| e.to_string())? = rows;
    state.mask_revision.fetch_add(1, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn update_hit_mask(
    state: State<'_, Arc<HitState>>,
    rows: Vec<Vec<[u16; 2]>>,
) -> Result<(), String> {
    replace_mask(state.inner().as_ref(), rows)
}

#[tauri::command]
fn set_cursor_passthrough(
    window: WebviewWindow,
    state: State<'_, Arc<HitState>>,
    enabled: bool,
) -> Result<(), String> {
    state.passthrough.store(enabled, Ordering::Relaxed);
    if !enabled {
        window
            .set_ignore_cursor_events(false)
            .map_err(|e| e.to_string())?;
        state.ignoring.store(false, Ordering::Relaxed);
    }
    Ok(())
}

fn apply_zoom(window: &WebviewWindow, state: &HitState, zoom: f64) -> Result<(), String> {
    validate_zoom(window, zoom)?;
    let old_origin = window.inner_position().map_err(|e| e.to_string())?;
    let old_size = window.outer_size().map_err(|e| e.to_string())?;
    let old_ground_y = old_origin.y + ground_offset(window, state)?;
    let monitor = window.current_monitor().map_err(|e| e.to_string())?;

    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    resize_scene(window, state, zoom, scale)?;
    state.zoom.store(zoom.to_bits(), Ordering::Relaxed);
    let size = window.outer_size().map_err(|e| e.to_string())?;
    // Keep the ground line and right edge stationary while resizing.
    let mut x = old_origin.x + old_size.width as i32 - size.width as i32;
    let offset = ground_offset(window, state)?;
    let mut y = old_ground_y - offset;
    if let Some(monitor) = monitor {
        let work = monitor.work_area();
        x = x.clamp(
            work.position.x,
            work.position.x + (work.size.width as i32 - size.width as i32).max(0),
        );
        y = y.clamp(
            work.position.y,
            work.position.y + (work.size.height as i32 - offset).max(0),
        );
    }
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    if state.docked.load(Ordering::Relaxed) {
        dock_to_taskbar(window, state)?;
    }
    Ok(())
}

#[tauri::command]
fn set_zoom(
    window: WebviewWindow,
    state: State<'_, Arc<HitState>>,
    zoom: f64,
) -> Result<Option<String>, String> {
    let pending = state.pending_placement.lock().map_err(|e| e.to_string())?;
    apply_zoom(&window, &state, zoom)?;
    if pending.is_none() {
        if let Some(placement) = window_placement(&window, &state) {
            return Ok(placement.save(&window).err());
        }
    }
    Ok(None)
}

fn monitor_identifier(monitor: &Monitor) -> Option<String> {
    let name = monitor.name()?;
    #[cfg(target_os = "windows")]
    if let Some(id) = monitor::device_interface(name) {
        return Some(id);
    }
    Some(name.clone())
}

fn find_saved_monitor(
    window: &WebviewWindow,
    saved: &WindowPlacement,
) -> tauri::Result<Option<Monitor>> {
    Ok(window.available_monitors()?.into_iter().find(|monitor| {
        // Older versions saved the current display number instead of the device interface.
        monitor.name() == Some(&saved.monitor)
            || monitor_identifier(monitor).is_some_and(|id| id.eq_ignore_ascii_case(&saved.monitor))
    }))
}

fn restore_window_placement(
    window: &WebviewWindow,
    state: &HitState,
    zoom: f64,
    legacy: Option<WindowPlacement>,
) -> Result<(), String> {
    validate_zoom(window, zoom)?;
    let saved = WindowPlacement::read(window);
    let needs_migration = saved.is_none();
    let mut placement = saved.or(legacy);
    let mut pending = state.pending_placement.lock().map_err(|e| e.to_string())?;
    if let Some(saved) = placement.as_mut() {
        if let Some(monitor) = find_saved_monitor(window, saved).map_err(|e| e.to_string())? {
            place_window(window, state, zoom, &monitor, Some(saved))?;
            *pending = None;
            save_restored_placement(window, saved, &monitor, needs_migration);
            return Ok(());
        }
    }
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Primary monitor is unavailable")?;
    place_window(window, state, zoom, &monitor, None)?;
    *pending = placement;
    Ok(())
}

fn save_restored_placement(
    window: &WebviewWindow,
    placement: &mut WindowPlacement,
    monitor: &Monitor,
    needs_migration: bool,
) {
    let id = monitor_identifier(monitor).unwrap_or_else(|| placement.monitor.clone());
    if needs_migration || placement.monitor != id {
        placement.monitor = id;
        let _ = placement.save(window);
    }
}

fn place_window(
    window: &WebviewWindow,
    state: &HitState,
    zoom: f64,
    monitor: &Monitor,
    placement: Option<&WindowPlacement>,
) -> Result<(), String> {
    let work = monitor.work_area();
    let scale = monitor.scale_factor();

    // Move to the target display before sizing so Windows applies its DPI.
    window
        .set_position(work.position)
        .map_err(|e| e.to_string())?;
    resize_scene(window, state, zoom, scale)?;
    state.zoom.store(zoom.to_bits(), Ordering::Relaxed);
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let max_x = work.size.width.saturating_sub(size.width) as i32;
    let max_y = work.size.height.saturating_sub(size.height) as i32;
    let docked_y = (work.size.height as i32 - scaled_ground_offset(state, scale)).max(0);
    let (x, y, docked) = match placement {
        Some(saved) => {
            let x = ((saved.x * scale).round() as i32).clamp(0, max_x);
            let y = if saved.docked {
                docked_y
            } else {
                ((saved.y * scale).round() as i32).clamp(0, max_y)
            };
            (x, y, saved.docked)
        }
        None => (
            (max_x - (24.0 * scale).round() as i32).max(0),
            docked_y,
            true,
        ),
    };
    window
        .set_position(tauri::PhysicalPosition::new(
            work.position.x + x,
            work.position.y + y,
        ))
        .map_err(|e| e.to_string())?;
    state.docked.store(docked, Ordering::Relaxed);
    Ok(())
}

#[cfg(target_os = "windows")]
fn update_window_layout(window: &WebviewWindow, state: &HitState) -> Result<(), String> {
    let mut pending = state.pending_placement.lock().map_err(|e| e.to_string())?;
    if state.dragging.load(Ordering::Relaxed) || !window.is_visible().map_err(|e| e.to_string())? {
        return Ok(());
    }
    if let Some(saved) = pending.as_mut() {
        // At login Windows can report the primary display before a secondary display is ready.
        if let Some(monitor) = find_saved_monitor(window, saved).map_err(|e| e.to_string())? {
            let zoom = f64::from_bits(state.zoom.load(Ordering::Relaxed));
            place_window(window, state, zoom, &monitor, Some(saved))?;
            save_restored_placement(window, saved, &monitor, true);
            *pending = None;
            return Ok(());
        }
    }
    if state.docked.load(Ordering::Relaxed) {
        dock_to_taskbar(window, state)?;
    }
    Ok(())
}

fn sync_window_priority(window: &WebviewWindow, state: &HitState, pinned: bool) -> tauri::Result<bool> {
    #[cfg(target_os = "windows")]
    let handle = window.hwnd()?;
    #[cfg(target_os = "windows")]
    let fullscreen_active = fullscreen::overlaps(handle);
    #[cfg(not(target_os = "windows"))]
    let fullscreen_active = false;
    if fullscreen_active != state.fullscreen_active.load(Ordering::Relaxed) {
        window.emit_to(window.label(), FULLSCREEN_EVENT, fullscreen_active)?;
        state.fullscreen_active.store(fullscreen_active, Ordering::Relaxed);
    }
    let yielding = pinned && fullscreen_active;
    let was_yielding = state.yielding_fullscreen.load(Ordering::Relaxed);
    if yielding && !was_yielding {
        window.set_focusable(false)?;
    } else if was_yielding && !yielding {
        window.set_always_on_bottom(false)?;
        window.set_focusable(true)?;
    }
    let topmost = pinned && !yielding;
    if window.is_always_on_top()? != topmost {
        window.set_always_on_top(topmost)?;
    }
    if yielding && !was_yielding {
        // Demoting from topmost alone can leave the camp above non-topmost fullscreen windows.
        window.set_always_on_bottom(true)?;
    }
    #[cfg(target_os = "windows")]
    // The runtime's cached topmost flag can differ from the actual Windows z-order.
    fullscreen::sync_topmost(handle, topmost).map_err(std::io::Error::other)?;
    state.yielding_fullscreen.store(yielding, Ordering::Relaxed);
    Ok(yielding)
}

#[tauri::command]
fn set_pinned(window: WebviewWindow, state: State<'_, Arc<HitState>>, pinned: bool) -> Result<(), String> {
    sync_window_priority(&window, &state, pinned).map_err(|error| error.to_string())?;
    state.pinned.store(pinned, Ordering::Relaxed);
    Ok(())
}

fn show_camp(window: &WebviewWindow, state: &HitState) -> tauri::Result<()> {
    let yielding = sync_window_priority(window, state, state.pinned.load(Ordering::Relaxed))?;
    window.show()?;
    tray::sync_visibility(window)?;
    if !yielding {
        window.set_focus()?;
    }
    Ok(())
}

#[tauri::command]
fn ready_window(
    window: WebviewWindow,
    state: State<'_, Arc<HitState>>,
    rows: Vec<Vec<[u16; 2]>>,
    pinned: bool,
    passthrough: bool,
    zoom: f64,
    scene_bottom: f64,
    ground_baseline: f64,
    placement: Option<WindowPlacement>,
) -> Result<(), String> {
    if !scene_bottom.is_finite() || !(1.0..=300.0).contains(&scene_bottom) {
        return Err("Invalid visible scene bottom".into());
    }
    if !ground_baseline.is_finite() || !(1.0..=scene_bottom).contains(&ground_baseline) {
        return Err("Invalid ground baseline".into());
    }
    state
        .scene_bottom
        .store(scene_bottom.to_bits(), Ordering::Relaxed);
    state
        .ground_baseline
        .store(ground_baseline.to_bits(), Ordering::Relaxed);
    replace_mask(state.inner().as_ref(), rows)?;
    restore_window_placement(&window, &state, zoom, placement)?;
    window.set_skip_taskbar(true).map_err(|e| e.to_string())?;
    state.pinned.store(pinned, Ordering::Relaxed);
    state.passthrough.store(passthrough, Ordering::Relaxed);
    show_camp(&window, &state).map_err(|e| e.to_string())?;
    // A reloaded WebView also needs the current state when the fullscreen window hasn't changed.
    window
        .emit_to(
            window.label(),
            FULLSCREEN_EVENT,
            state.fullscreen_active.load(Ordering::Relaxed),
        )
        .map_err(|e| e.to_string())?;
    state.ready.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn desktop_status(
    window: WebviewWindow,
    state: State<'_, Arc<HitState>>,
) -> Result<DesktopStatus, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Monitor unavailable")?;
    let work = monitor.work_area();
    let work_bottom = work.position.y + work.size.height as i32;
    #[cfg(target_os = "windows")]
    let always_on_top = fullscreen::is_topmost(window.hwnd().map_err(|e| e.to_string())?);
    #[cfg(not(target_os = "windows"))]
    let always_on_top = window.is_always_on_top().map_err(|e| e.to_string())?;
    Ok(DesktopStatus {
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        scale_factor: scale,
        always_on_top,
        fullscreen_active: state.fullscreen_active.load(Ordering::Relaxed),
        ignoring_cursor: state.ignoring.load(Ordering::Relaxed),
        visible: window.is_visible().map_err(|e| e.to_string())?,
        ready: state.ready.load(Ordering::Relaxed),
        passthrough: state.passthrough.load(Ordering::Relaxed),
        physical_x: position.x,
        physical_y: position.y,
        zoom: f64::from_bits(state.zoom.load(Ordering::Relaxed)),
        scene_bottom: f64::from_bits(state.scene_bottom.load(Ordering::Relaxed)),
        ground_baseline: f64::from_bits(state.ground_baseline.load(Ordering::Relaxed)),
        docked: state.docked.load(Ordering::Relaxed),
        work_area_bottom_physical: work_bottom,
        taskbar_height_physical: (monitor.position().y + monitor.size().height as i32 - work_bottom)
            .max(0) as u32,
        hit_mask_revision: state.mask_revision.load(Ordering::Relaxed),
    })
}

#[cfg(target_os = "windows")]
fn cursor_guard(window: WebviewWindow, state: Arc<HitState>) {
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(point: *mut Point) -> i32;
        fn GetAsyncKeyState(key: i32) -> i16;
    }
    std::thread::spawn(move || {
        let mut next_layout_check = Instant::now();
        let mut next_fullscreen_check = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(35));
            if !state.ready.load(Ordering::Relaxed) {
                continue;
            }
            let visible = match window.is_visible() {
                Err(_) => break,
                Ok(visible) => visible,
            };
            let now = Instant::now();
            if now >= next_fullscreen_check {
                next_fullscreen_check = now + Duration::from_millis(100);
                let camp = window.clone();
                let state = state.clone();
                let _ = window.run_on_main_thread(move || {
                    let _ = sync_window_priority(&camp, &state, state.pinned.load(Ordering::Relaxed));
                });
            }
            if !visible {
                continue;
            }
            if now >= next_layout_check {
                next_layout_check = now + Duration::from_secs(1);
                let camp = window.clone();
                let state = state.clone();
                let _ = window.run_on_main_thread(move || {
                    let _ = update_window_layout(&camp, &state);
                });
            }
            // Never change input handling while Windows is tracking a pressed button/drag.
            if unsafe { GetAsyncKeyState(1) } < 0 {
                continue;
            }
            let mut cursor = Point { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut cursor) } == 0 {
                continue;
            }
            let (Ok(origin), Ok(scale)) = (window.inner_position(), window.scale_factor()) else {
                continue;
            };
            let zoom = f64::from_bits(state.zoom.load(Ordering::Relaxed));
            let over_taskbar = state.docked.load(Ordering::Relaxed)
                && ground_offset(&window, &state)
                    .map(|offset| cursor.y >= origin.y + offset)
                    .unwrap_or(false);
            let logical_x = (cursor.x - origin.x) as f64 / scale;
            let logical_y = (cursor.y - origin.y) as f64 / scale;
            let x = (logical_x / zoom).floor() as i32;
            let y = (logical_y / zoom).floor() as i32;
            let picture_hit = x >= 0
                && x < 500
                && y >= 0
                && y < 300
                && state
                    .rows
                    .lock()
                    .map(|rows| {
                        rows.get(y as usize)
                            .map(|row| {
                                row.iter()
                                    .any(|span| x >= span[0] as i32 && x < span[1] as i32)
                            })
                            .unwrap_or(false)
                    })
                    .unwrap_or(true);
            // Keep the clipped ground boundary from intercepting taskbar input.
            let hit = !over_taskbar && (!state.passthrough.load(Ordering::Relaxed) || picture_hit);
            let ignore = !hit;
            if state.ignoring.load(Ordering::Relaxed) != ignore {
                if window.set_ignore_cursor_events(ignore).is_ok() {
                    state.ignoring.store(ignore, Ordering::Relaxed);
                }
            }
        }
    });
}

fn main() {
    let state = Arc::new(HitState {
        rows: Mutex::new(vec![]),
        mask_revision: AtomicU64::new(0),
        ignoring: AtomicBool::new(false),
        ready: AtomicBool::new(false),
        pinned: AtomicBool::new(false),
        fullscreen_active: AtomicBool::new(false),
        yielding_fullscreen: AtomicBool::new(false),
        passthrough: AtomicBool::new(true),
        zoom: AtomicU64::new(1.0f64.to_bits()),
        scene_bottom: AtomicU64::new(300.0f64.to_bits()),
        ground_baseline: AtomicU64::new(300.0f64.to_bits()),
        docked: AtomicBool::new(false),
        dragging: AtomicBool::new(false),
        pending_placement: Mutex::new(None),
    });
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            ready_window,
            update_hit_mask,
            set_cursor_passthrough,
            desktop_status,
            set_pinned,
            set_zoom,
            begin_drag,
            finish_drag,
            settings::load_time_pause,
            settings::save_time_pause,
            i18n::get_camp_locale,
            tray::set_tray_notice,
            tray::sync_tray,
            tray::toggle_camp_visibility,
            about::show_about,
            about::open_credit_link
        ])
        .setup(move |app| {
            let window = app.get_webview_window("main").expect("main window");
            i18n::setup(&window)?;
            tray::setup(app)?;
            #[cfg(target_os = "windows")]
            cursor_guard(window, state.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Unable to run Moonlit Camp");
}
