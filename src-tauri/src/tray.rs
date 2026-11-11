use serde::Deserialize;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, State, WebviewWindow, Wry,
};

const TRAY_ID: &str = "camp-tray";
const TRAY_SHORTCUTS: &str = "双击显示/隐藏 · 右键打开菜单";

pub struct TrayControls {
    visibility: MenuItem<Wry>,
    checks: Vec<CheckMenuItem<Wry>>,
    zoom: Submenu<Wry>,
    speed: Submenu<Wry>,
    cycle: Submenu<Wry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraySettings {
    pinned: bool,
    muted: bool,
    paused: bool,
    time_paused: bool,
    steam: bool,
    passthrough: bool,
    zoom: f64,
    frame_duration: u16,
    cycle_minutes: u16,
}

#[tauri::command]
pub fn set_tray_notice(app: AppHandle, text: String) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or("营地托盘图标不可用")?;
    let mut tooltip = String::from("月下营地 · ");
    // Windows reserves 128 UTF-16 units for the tooltip, including the terminator.
    let mut remaining = 127 - tooltip.encode_utf16().count() - TRAY_SHORTCUTS.encode_utf16().count() - 1;
    for character in text.trim().chars() {
        let length = character.len_utf16();
        if length > remaining {
            break;
        }
        tooltip.push(character);
        remaining -= length;
    }
    tooltip.push('\n');
    tooltip.push_str(TRAY_SHORTCUTS);
    tray.set_tooltip(Some(tooltip)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn sync_tray(controls: State<'_, TrayControls>, settings: TraySettings) -> Result<(), String> {
    for item in &controls.checks {
        let checked = match item.id().as_ref() {
            "pin" => settings.pinned,
            "sound" => !settings.muted,
            "pause" => settings.paused,
            "pause-time" => settings.time_paused,
            "steam" => settings.steam,
            "passthrough" => settings.passthrough,
            id if id.starts_with("zoom-") => {
                id[5..].parse::<u16>().ok() == Some((settings.zoom * 100.0).round() as u16)
            }
            id if id.starts_with("speed-") => {
                id[6..].parse::<u16>().ok() == Some(settings.frame_duration)
            }
            id if id.starts_with("cycle-") => {
                id[6..].parse::<u16>().ok() == Some(settings.cycle_minutes)
            }
            _ => false,
        };
        item.set_checked(checked).map_err(|e| e.to_string())?;
    }
    controls
        .zoom
        .set_text(format!("场景缩放 · {:.0}%", settings.zoom * 100.0))
        .map_err(|e| e.to_string())?;
    controls
        .speed
        .set_text(format!(
            "火焰节奏 · {:.1}×",
            100.0 / settings.frame_duration as f64
        ))
        .map_err(|e| e.to_string())?;
    controls
        .cycle
        .set_text(if settings.time_paused {
            "日夜周期 · 已暂停".to_string()
        } else {
            format!("日夜周期 · {} 分钟一昼夜", settings.cycle_minutes)
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let mut checks = Vec::new();
    for (id, label, checked) in [
        ("pin", "窗口置顶", true),
        ("sound", "篝火声音", false),
        ("pause", "暂停动画", false),
        ("steam", "水壶蒸汽", true),
        ("passthrough", "空白处鼠标穿透", true),
        ("pause-time", "暂停时间", false),
    ] {
        checks.push(CheckMenuItem::with_id(
            app,
            id,
            label,
            true,
            checked,
            None::<&str>,
        )?);
    }
    let zoom = Submenu::new(app, "场景缩放", true)?;
    for percent in
        (crate::MIN_ZOOM_PERCENT..=crate::MAX_ZOOM_PERCENT).step_by(crate::ZOOM_STEP_PERCENT)
    {
        let item = CheckMenuItem::with_id(
            app,
            format!("zoom-{percent}"),
            format!("{percent}%"),
            true,
            percent == 100,
            None::<&str>,
        )?;
        zoom.append(&item)?;
        checks.push(item);
    }
    let speed = Submenu::new(app, "火焰节奏", true)?;
    // Preserve every step from the previous 70–180 ms slider.
    for duration in (70..=180).step_by(10) {
        let suffix = match duration {
            70 => "（最快）",
            100 => "（标准）",
            180 => "（最慢）",
            _ => "",
        };
        let item = CheckMenuItem::with_id(
            app,
            format!("speed-{duration}"),
            format!("{:.2}×{suffix}", 100.0 / duration as f64),
            true,
            duration == 100,
            None::<&str>,
        )?;
        speed.append(&item)?;
        checks.push(item);
    }
    let cycle = Submenu::new(app, "日夜周期 · 20 分钟一昼夜", true)?;
    for (minutes, label) in [
        (20, "20 分钟一昼夜（默认）"),
        (30, "30 分钟一昼夜"),
        (45, "45 分钟一昼夜"),
        (60, "1 小时一昼夜"),
        (90, "1.5 小时一昼夜"),
        (120, "2 小时一昼夜"),
    ] {
        let item = CheckMenuItem::with_id(
            app,
            format!("cycle-{minutes}"),
            label,
            true,
            minutes == 20,
            None::<&str>,
        )?;
        cycle.append(&item)?;
        checks.push(item);
    }
    let visibility = MenuItem::with_id(app, "toggle-visibility", "显示营地", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &visibility,
            &PredefinedMenuItem::separator(app)?,
            &checks[0],
            &checks[1],
            &checks[2],
            &checks[5],
            &checks[3],
            &checks[4],
            &PredefinedMenuItem::separator(app)?,
            &zoom,
            &speed,
            &cycle,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "about", "关于月下营地…", true, None::<&str>)?,
            &MenuItem::with_id(app, "quit", "退出营地", true, None::<&str>)?,
        ],
    )?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().expect("campfire icon").clone())
        .tooltip(format!("月下营地 · {TRAY_SHORTCUTS}"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "about" => crate::about::open(app),
            "toggle-visibility" => {
                let _ = toggle_camp_visibility(app.clone());
            }
            id => {
                let _ = app.emit_to("main", "camp-menu", id);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                let _ = toggle_camp_visibility(tray.app_handle().clone());
            }
        })
        .build(app)?;
    app.manage(TrayControls {
        visibility,
        checks,
        zoom,
        speed,
        cycle,
    });
    Ok(())
}

pub fn sync_visibility(window: &WebviewWindow) -> tauri::Result<()> {
    let controls = window.state::<TrayControls>();
    controls.visibility.set_text(if window.is_visible()? {
        "隐藏营地"
    } else {
        "显示营地"
    })
}

#[tauri::command]
pub fn toggle_camp_visibility(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Camp window is unavailable")?;
    let show = !window.is_visible().map_err(|e| e.to_string())?;
    if show {
        let state = window.state::<std::sync::Arc<crate::HitState>>();
        crate::show_camp(&window, &state).map_err(|e| e.to_string())?;
    } else {
        window.hide().map_err(|e| e.to_string())?;
        sync_visibility(&window).map_err(|e| e.to_string())?;
    }
    Ok(show)
}
