use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const FIRE_DOWNLOAD_URL: &str = "https://devkidd.itch.io/pixel-fire-asset-pack";

#[tauri::command]
pub async fn show_about(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("about") {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(&app, "about", WebviewUrl::App("about.html".into()))
        .title("关于月下营地")
        .inner_size(440.0, 560.0)
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
    Ok(())
}

pub fn open(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = show_about(app).await;
    });
}

#[tauri::command]
pub fn open_fire_download() -> Result<(), String> {
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
        let url: Vec<u16> = FIRE_DOWNLOAD_URL.encode_utf16().chain([0]).collect();
        let result =
            unsafe { ShellExecuteW(0, operation.as_ptr(), url.as_ptr(), null(), null(), 1) };
        if result > 32 {
            Ok(())
        } else {
            Err("无法打开浏览器，请复制素材页面地址访问".into())
        }
    }
    #[cfg(not(target_os = "windows"))]
    Err(format!("请在浏览器访问 {FIRE_DOWNLOAD_URL}"))
}
