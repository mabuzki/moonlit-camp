use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn show_about(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("about") {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let window = WebviewWindowBuilder::new(&app, "about", WebviewUrl::App("about.html".into()))
        .title(crate::i18n::current(&app).text("aboutTitle"))
        .inner_size(440.0, 340.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .theme(Some(tauri::Theme::Dark))
        .background_color(tauri::utils::config::Color(32, 36, 44, 255))
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    // A language switch can arrive while the WebView is being created.
    window.set_title(crate::i18n::current(&app).text("aboutTitle"))
        .map_err(|e| e.to_string())
}

pub fn open(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = show_about(app).await;
    });
}

#[tauri::command]
pub fn open_credit_link(link: &str) -> Result<(), String> {
    let address = match link {
        "fire-pack" => "https://devkidd.itch.io/pixel-fire-asset-pack",
        "fire-recording" => "https://freesound.org/people/homejrande/sounds/17374/",
        "recording-license" => "https://creativecommons.org/licenses/by-nc/3.0/",
        _ => return Err("Unknown asset link".into()),
    };
    #[cfg(target_os = "windows")]
    {
        use std::ptr::null;
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                window: isize,
                operation: *const u16,
                file: *const u16,
                parameters: *const u16,
                directory: *const u16,
                show: i32,
            ) -> isize;
        }
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        let url: Vec<u16> = address.encode_utf16().chain([0]).collect();
        let result =
            unsafe { ShellExecuteW(0, operation.as_ptr(), url.as_ptr(), null(), null(), 1) };
        if result > 32 {
            Ok(())
        } else {
            Err(format!("ShellExecuteW failed with code {result}"))
        }
    }
    #[cfg(not(target_os = "windows"))]
    Err(format!("Could not open {address}"))
}
