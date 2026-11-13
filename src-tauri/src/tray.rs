use crate::i18n::{self, Locale, LOCALES};
use serde::Deserialize;
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, State, WebviewWindow, Wry,
};

const TRAY_ID: &str = "camp-tray";
#[cfg(target_os = "windows")]
const STARTUP_ID: &str = "autostart";
const TOGGLES: [(&str, &str, fn(&TraySettings) -> bool); 6] = [
    ("pin", "pin", |s| s.pinned),
    ("sound", "sound", |s| !s.muted),
    ("pause", "pause", |s| s.paused),
    ("pause-time", "pauseTime", |s| s.time_paused),
    ("steam", "steam", |s| s.steam),
    ("passthrough", "passthrough", |s| s.passthrough),
];
const CYCLE_MINUTES: [u16; 6] = [20, 30, 45, 60, 90, 120];

pub struct TrayControls {
    visibility: MenuItem<Wry>,
    toggles: Vec<CheckMenuItem<Wry>>,
    zoom: Submenu<Wry>,
    zoom_options: Vec<(u16, CheckMenuItem<Wry>)>,
    speed: Submenu<Wry>,
    speed_options: Vec<(u16, CheckMenuItem<Wry>)>,
    cycle: Submenu<Wry>,
    cycle_options: Vec<(u16, CheckMenuItem<Wry>)>,
    language: Submenu<Wry>,
    language_options: Vec<(&'static Locale, CheckMenuItem<Wry>)>,
    #[cfg(target_os = "windows")]
    startup: CheckMenuItem<Wry>,
    about: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    settings: Mutex<TraySettings>,
}

#[derive(Clone, Copy, Deserialize)]
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

impl Default for TraySettings {
    fn default() -> Self {
        Self {
            pinned: true,
            muted: true,
            paused: false,
            time_paused: false,
            steam: true,
            passthrough: true,
            zoom: 1.0,
            frame_duration: 100,
            cycle_minutes: 20,
        }
    }
}

fn tooltip(locale: &Locale, notice: &str) -> String {
    let title = locale.text("appName");
    let shortcuts = locale.text("trayShortcuts");
    let notice = notice.trim();
    if notice.is_empty() {
        return format!("{title} · {shortcuts}");
    }
    let prefix = format!("{title} · ");
    let full = format!("{prefix}{notice}\n{shortcuts}");
    // Windows reserves 128 UTF-16 units, including the terminator.
    if full.encode_utf16().count() <= 127 {
        return full;
    }
    let mut text = format!("{prefix}{notice}");
    if text.encode_utf16().count() > 127 {
        let mut units = 0;
        text = text
            .chars()
            .take_while(|character| {
                units += character.len_utf16();
                units <= 126
            })
            .collect();
        text.push('…');
    }
    text
}

#[tauri::command]
pub fn set_tray_notice(app: AppHandle, text: String, language: &str) -> Result<(), String> {
    let locale = i18n::current(&app);
    if locale.code != language {
        return Ok(());
    }
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or("Camp tray icon is unavailable")?;
    tray.set_tooltip(Some(tooltip(locale, &text)))
        .map_err(|error| error.to_string())
}

fn zoom_label(locale: &Locale, percent: u16) -> String {
    locale.format("percentage", &locale.number(percent))
}

fn speed_label(locale: &Locale, duration: u16) -> String {
    let value = format!(
        "{}×",
        locale.number(format!("{:.2}", 100.0 / f64::from(duration)))
    );
    match duration {
        70 => locale.format("speedFastest", &value),
        100 => locale.format("speedNormal", &value),
        180 => locale.format("speedSlowest", &value),
        _ => value,
    }
}

fn cycle_label(locale: &Locale, minutes: u16) -> String {
    match minutes {
        60 => locale.text("cycle60").to_string(),
        90 => locale.text("cycle90").to_string(),
        120 => locale.text("cycle120").to_string(),
        _ => locale.format("cycleMinutes", &locale.number(minutes)),
    }
}

fn cycle_option_label(locale: &Locale, minutes: u16) -> String {
    let label = cycle_label(locale, minutes);
    if minutes == 20 {
        locale.format("cycleDefault", &label)
    } else {
        label
    }
}

impl TrayControls {
    fn sync_settings(&self, locale: &Locale, settings: TraySettings) -> tauri::Result<()> {
        for (item, (_, _, is_checked)) in self.toggles.iter().zip(TOGGLES) {
            item.set_checked(is_checked(&settings))?;
        }
        let zoom = (settings.zoom * 100.0).round() as u16;
        for (percent, item) in &self.zoom_options {
            item.set_checked(*percent == zoom)?;
        }
        for (duration, item) in &self.speed_options {
            item.set_checked(*duration == settings.frame_duration)?;
        }
        for (minutes, item) in &self.cycle_options {
            item.set_checked(*minutes == settings.cycle_minutes)?;
        }
        self.sync_summaries(locale, settings)
    }

    fn sync_summaries(&self, locale: &Locale, settings: TraySettings) -> tauri::Result<()> {
        let zoom = (settings.zoom * 100.0).round() as u16;
        self.zoom.set_text(format!(
            "{} · {}",
            locale.text("zoom"),
            zoom_label(locale, zoom)
        ))?;
        self.speed.set_text(format!(
            "{} · {}×",
            locale.text("speed"),
            locale.number(format!("{:.1}", 100.0 / f64::from(settings.frame_duration)))
        ))?;
        let cycle = if settings.time_paused {
            locale.text("cyclePaused").to_string()
        } else {
            cycle_label(locale, settings.cycle_minutes)
        };
        self.cycle
            .set_text(format!("{} · {cycle}", locale.text("cycle")))
    }

    fn check_language(&self, locale: &Locale) -> tauri::Result<()> {
        for (candidate, item) in &self.language_options {
            item.set_checked(candidate.code == locale.code)?;
        }
        Ok(())
    }

    fn sync_language(&self, window: &WebviewWindow, locale: &Locale) -> tauri::Result<()> {
        self.language.set_text(locale.text("language"))?;
        self.check_language(locale)?;
        self.visibility
            .set_text(visibility_label(locale, window.is_visible()?))?;
        for (item, (_, key, _)) in self.toggles.iter().zip(TOGGLES) {
            item.set_text(locale.text(key))?;
        }
        for (percent, item) in &self.zoom_options {
            item.set_text(zoom_label(locale, *percent))?;
        }
        for (duration, item) in &self.speed_options {
            item.set_text(speed_label(locale, *duration))?;
        }
        for (minutes, item) in &self.cycle_options {
            item.set_text(cycle_option_label(locale, *minutes))?;
        }
        #[cfg(target_os = "windows")]
        self.startup.set_text(locale.text("autostart"))?;
        self.about.set_text(about_label(locale))?;
        self.quit.set_text(locale.text("quit"))?;
        let settings = *self.settings.lock().unwrap();
        self.sync_summaries(locale, settings)
    }
}

#[tauri::command]
pub fn sync_tray(
    app: AppHandle,
    controls: State<'_, TrayControls>,
    settings: TraySettings,
) -> Result<(), String> {
    *controls.settings.lock().unwrap() = settings;
    controls
        .sync_settings(i18n::current(&app), settings)
        .map_err(|error| error.to_string())
}

fn options(
    app: &App,
    submenu: &Submenu<Wry>,
    group: &str,
    values: impl Iterator<Item = u16>,
    selected: u16,
    label: impl Fn(u16) -> String,
) -> tauri::Result<Vec<(u16, CheckMenuItem<Wry>)>> {
    values
        .map(|value| {
            let item = CheckMenuItem::with_id(
                app,
                format!("{group}-{value}"),
                label(value),
                true,
                value == selected,
                None::<&str>,
            )?;
            submenu.append(&item)?;
            Ok((value, item))
        })
        .collect()
}

fn about_label(locale: &Locale) -> String {
    format!("{}…", locale.text("aboutTitle"))
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let locale = i18n::current(app.handle());
    let settings = TraySettings::default();
    let toggles = TOGGLES
        .iter()
        .map(|(id, key, is_checked)| {
            CheckMenuItem::with_id(
                app,
                *id,
                locale.text(key),
                true,
                is_checked(&settings),
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let zoom = Submenu::new(app, locale.text("zoom"), true)?;
    let zoom_options = options(
        app,
        &zoom,
        "zoom",
        (crate::MIN_ZOOM_PERCENT..=crate::MAX_ZOOM_PERCENT).step_by(crate::ZOOM_STEP_PERCENT),
        100,
        |value| zoom_label(locale, value),
    )?;
    let speed = Submenu::new(app, locale.text("speed"), true)?;
    // Preserve every step from the previous 70–180 ms slider.
    let speed_options = options(
        app,
        &speed,
        "speed",
        (70..=180).step_by(10),
        settings.frame_duration,
        |value| speed_label(locale, value),
    )?;
    let cycle = Submenu::new(app, locale.text("cycle"), true)?;
    let cycle_options = options(
        app,
        &cycle,
        "cycle",
        CYCLE_MINUTES.into_iter(),
        settings.cycle_minutes,
        |value| cycle_option_label(locale, value),
    )?;
    let language = Submenu::new(app, locale.text("language"), true)?;
    let mut language_options = Vec::new();
    for candidate in LOCALES.iter() {
        let item = CheckMenuItem::with_id(
            app,
            format!("language-{}", candidate.code),
            candidate.text("languageName"),
            true,
            candidate.code == locale.code,
            None::<&str>,
        )?;
        language.append(&item)?;
        language_options.push((candidate, item));
    }
    let visibility = MenuItem::with_id(
        app,
        "toggle-visibility",
        locale.text("showCamp"),
        true,
        None::<&str>,
    )?;
    #[cfg(target_os = "windows")]
    let startup_path = crate::startup::shortcut_path().ok();
    #[cfg(target_os = "windows")]
    let startup = {
        let state = startup_path
            .as_ref()
            .and_then(|path| path.try_exists().ok());
        CheckMenuItem::with_id(
            app,
            STARTUP_ID,
            locale.text("autostart"),
            state.is_some(),
            state.unwrap_or(false),
            None::<&str>,
        )?
    };
    let about = MenuItem::with_id(app, "about", about_label(locale), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", locale.text("quit"), true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &visibility,
            &PredefinedMenuItem::separator(app)?,
            &toggles[0],
            &toggles[1],
            &toggles[2],
            &toggles[3],
            &toggles[4],
            &toggles[5],
            &PredefinedMenuItem::separator(app)?,
            &zoom,
            &speed,
            &cycle,
            &PredefinedMenuItem::separator(app)?,
            &language,
            #[cfg(target_os = "windows")]
            &startup,
            &about,
            &quit,
        ],
    )?;
    let controls = TrayControls {
        visibility,
        toggles,
        zoom,
        zoom_options,
        speed,
        speed_options,
        cycle,
        cycle_options,
        language,
        language_options,
        #[cfg(target_os = "windows")]
        startup,
        about,
        quit,
        settings: Mutex::new(settings),
    };
    controls.sync_summaries(locale, settings)?;
    app.manage(controls);
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().expect("campfire icon").clone())
        .tooltip(tooltip(locale, ""))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "about" => crate::about::open(app),
            "toggle-visibility" => {
                let _ = toggle_camp_visibility(app.clone());
            }
            #[cfg(target_os = "windows")]
            STARTUP_ID => {
                if let Some(path) = &startup_path {
                    update_startup(app, &app.state::<TrayControls>().startup, path);
                }
            }
            id if id.starts_with("language-") => {
                if let Err(error) = change_language(app, &id[9..]) {
                    eprintln!("Could not update the tray language: {error}");
                }
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
    Ok(())
}

fn change_language(app: &AppHandle, code: &str) -> tauri::Result<()> {
    let Some(locale) = i18n::locale(code) else {
        return Ok(());
    };
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let controls = app.state::<TrayControls>();
    if let Err(error) = i18n::save(&window, locale) {
        let current = i18n::current(app);
        controls.check_language(current)?;
        #[cfg(target_os = "windows")]
        show_error(app, current, "saveLanguageFailed", &error);
        #[cfg(not(target_os = "windows"))]
        eprintln!("{} {error}", current.text("saveLanguageFailed"));
        return Ok(());
    }
    i18n::apply(&window, locale)?;
    controls.sync_language(&window, locale)?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(tooltip(locale, "")))?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn show_error(app: &AppHandle, locale: &Locale, key: &str, error: &str) {
    use windows::{
        core::HSTRING,
        Win32::UI::WindowsAndMessaging::{
            MessageBoxW, MB_ICONERROR, MB_OK, MB_RIGHT, MB_RTLREADING,
        },
    };

    let message = HSTRING::from(format!("{}\n{error}", locale.text(key)));
    let title = HSTRING::from(locale.text("appName"));
    let owner = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok());
    let mut style = MB_OK | MB_ICONERROR;
    if locale.code == "ar" {
        style |= MB_RIGHT | MB_RTLREADING;
    }
    unsafe { MessageBoxW(owner, &message, &title, style) };
}

#[cfg(target_os = "windows")]
fn update_startup(app: &AppHandle, item: &CheckMenuItem<Wry>, path: &std::path::Path) {
    // Windows toggles the check mark before dispatching the menu event.
    let Ok(enabled) = item.is_checked() else {
        return;
    };
    let locale = i18n::current(app);
    if let Err(error) = crate::startup::set_enabled(path, enabled, locale.text("appName")) {
        let _ = item.set_checked(path.try_exists().unwrap_or(!enabled));
        show_error(app, locale, "startupFailed", &error.to_string());
    }
}

fn visibility_label(locale: &Locale, visible: bool) -> &str {
    locale.text(if visible { "hideCamp" } else { "showCamp" })
}

pub fn sync_visibility(window: &WebviewWindow) -> tauri::Result<()> {
    let controls = window.state::<TrayControls>();
    controls.visibility.set_text(visibility_label(
        i18n::current(window.app_handle()),
        window.is_visible()?,
    ))
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
