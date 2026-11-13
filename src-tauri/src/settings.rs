use serde::{de::DeserializeOwned, Serialize};
use std::{fs, io, path::PathBuf};
use tauri::{Manager, WebviewWindow};

fn path(window: &WebviewWindow, file: &str) -> Result<PathBuf, String> {
    Ok(window
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join(file))
}

pub fn read<T: DeserializeOwned>(window: &WebviewWindow, file: &str) -> Option<T> {
    let contents = fs::read(path(window, file).ok()?).ok()?;
    serde_json::from_slice(&contents).ok()
}

pub fn save<T: Serialize>(window: &WebviewWindow, file: &str, value: &T) -> Result<(), String> {
    let path = path(window, file)?;
    let contents = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let write = || -> io::Result<()> {
        if let Some(directory) = path.parent() {
            fs::create_dir_all(directory)?;
        }
        fs::write(&temporary, contents)?;
        fs::rename(&temporary, &path)
    };
    write().map_err(|error| error.to_string())
}

const TIME_PAUSE_FILE: &str = "time-pause.json";

#[tauri::command]
pub fn load_time_pause(window: WebviewWindow) -> Option<f64> {
    read(&window, TIME_PAUSE_FILE).flatten()
}

#[tauri::command]
pub fn save_time_pause(window: WebviewWindow, paused_cycle_offset: Option<f64>) -> Result<(), String> {
    save(&window, TIME_PAUSE_FILE, &paused_cycle_offset).map_err(|error| {
        format!("{} {error}", crate::i18n::current(window.app_handle()).text("saveTimePauseFailed"))
    })
}
