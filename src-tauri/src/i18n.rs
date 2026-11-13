use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const LANGUAGE_FILE: &str = "language.json";
const FALLBACK: &str = "en";

pub struct Locale {
    pub code: &'static str,
    messages: HashMap<String, String>,
}

impl Locale {
    pub fn text(&self, key: &str) -> &str {
        self.messages
            .get(key)
            .map(String::as_str)
            .unwrap_or_else(|| &locale(FALLBACK).unwrap().messages[key])
    }

    pub fn format(&self, key: &str, value: &str) -> String {
        self.text(key).replace("{value}", value)
    }

    pub fn number(&self, number: impl std::fmt::Display) -> String {
        let number = number.to_string();
        match self.code {
            "fr" | "ru" | "es" => number.replace('.', ","),
            "ar" => number
                .chars()
                .map(|character| match character {
                    '0'..='9' => {
                        char::from_u32('٠' as u32 + character as u32 - '0' as u32).unwrap()
                    }
                    '.' => '٫',
                    _ => character,
                })
                .collect(),
            _ => number,
        }
    }
}

pub static LOCALES: LazyLock<[Locale; 8]> = LazyLock::new(|| {
    [
        ("zh-Hans", include_str!("../../locales/zh-Hans.json")),
        ("zh-Hant", include_str!("../../locales/zh-Hant.json")),
        ("ja", include_str!("../../locales/ja.json")),
        ("en", include_str!("../../locales/en.json")),
        ("fr", include_str!("../../locales/fr.json")),
        ("ru", include_str!("../../locales/ru.json")),
        ("es", include_str!("../../locales/es.json")),
        ("ar", include_str!("../../locales/ar.json")),
    ]
    .map(|(code, contents)| Locale {
        code,
        messages: serde_json::from_str(contents).expect("valid locale catalog"),
    })
});

pub fn locale(code: &str) -> Option<&'static Locale> {
    LOCALES.iter().find(|locale| locale.code == code)
}

#[cfg(target_os = "windows")]
fn supported_locale(tag: &str) -> Option<&'static Locale> {
    let tag = tag.to_ascii_lowercase();
    let mut parts = tag.split('-');
    let language = parts.next()?;
    if language == "zh" {
        let traditional = !parts.clone().any(|part| part == "hans")
            && parts.any(|part| matches!(part, "hant" | "tw" | "hk" | "mo"));
        return locale(if traditional { "zh-Hant" } else { "zh-Hans" });
    }
    locale(language)
}

#[cfg(target_os = "windows")]
fn system_locale() -> Option<&'static Locale> {
    use windows::{
        core::PWSTR,
        Win32::Globalization::{GetUserPreferredUILanguages, MUI_LANGUAGE_NAME},
    };

    let mut count = 0;
    let mut length = 0;
    let mut buffer = unsafe {
        GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, &mut count, None, &mut length).ok()?;
        let mut buffer = vec![0u16; length as usize];
        GetUserPreferredUILanguages(
            MUI_LANGUAGE_NAME,
            &mut count,
            Some(PWSTR(buffer.as_mut_ptr())),
            &mut length,
        )
        .ok()?;
        buffer
    };
    buffer.truncate(length as usize);
    buffer
        .split(|character| *character == 0)
        .find_map(|tag| supported_locale(&String::from_utf16_lossy(tag)))
}

#[cfg(not(target_os = "windows"))]
fn system_locale() -> Option<&'static Locale> {
    None
}

struct Language(Mutex<&'static Locale>);

pub fn setup(window: &WebviewWindow) -> tauri::Result<()> {
    let saved = crate::settings::read::<String>(window, LANGUAGE_FILE);
    let locale = saved
        .as_deref()
        .and_then(locale)
        .or_else(system_locale)
        .unwrap_or_else(|| locale(FALLBACK).unwrap());
    window.manage(Language(Mutex::new(locale)));
    window.set_title(locale.text("appName"))
}

pub fn current(app: &AppHandle) -> &'static Locale {
    *app.state::<Language>().0.lock().unwrap()
}

pub fn save(window: &WebviewWindow, locale: &'static Locale) -> Result<(), String> {
    crate::settings::save(window, LANGUAGE_FILE, &locale.code)
}

pub fn apply(window: &WebviewWindow, locale: &'static Locale) -> tauri::Result<()> {
    *window.state::<Language>().0.lock().unwrap() = locale;
    window.set_title(locale.text("appName"))?;
    if let Some(about) = window.get_webview_window("about") {
        about.set_title(locale.text("aboutTitle"))?;
    }
    window.emit("camp-language", locale.code)
}

#[tauri::command]
pub fn get_camp_locale(app: AppHandle) -> &'static str {
    current(&app).code
}
