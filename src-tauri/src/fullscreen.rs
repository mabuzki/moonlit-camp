use std::mem::size_of;
use windows::{
    core::BOOL,
    Win32::{
        Foundation::{HWND, LPARAM, RECT},
        Graphics::{
            Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
            Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONULL},
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GetClassNameW, GetShellWindow, GetWindowLongW, GetWindowRect,
            GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, SetWindowPos,
            GWL_EXSTYLE, GWL_STYLE, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE,
            SWP_NOOWNERZORDER, SWP_NOSIZE, WS_CAPTION, WS_EX_LAYERED, WS_EX_TOPMOST,
            WS_EX_TRANSPARENT,
        },
    },
};

pub fn is_topmost(window: HWND) -> bool {
    let style = unsafe { GetWindowLongW(window, GWL_EXSTYLE) } as u32;
    style & WS_EX_TOPMOST.0 != 0
}

pub fn sync_topmost(window: HWND, topmost: bool) -> windows::core::Result<()> {
    if is_topmost(window) == topmost {
        return Ok(());
    }
    let order = if topmost {
        HWND_TOPMOST
    } else {
        HWND_NOTOPMOST
    };
    unsafe {
        SetWindowPos(
            window,
            Some(order),
            0,
            0,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER,
        )
    }
}

struct WindowScan {
    camp: RECT,
    shell: HWND,
    found: bool,
}

pub fn overlaps(camp: HWND) -> bool {
    let mut bounds = RECT::default();
    if unsafe { GetWindowRect(camp, &mut bounds) }.is_err() {
        return false;
    }
    let mut scan = WindowScan {
        camp: bounds,
        shell: unsafe { GetShellWindow() },
        found: false,
    };
    // EnumWindows calls back synchronously and returns early when a match is found.
    let _ = unsafe {
        EnumWindows(
            Some(check_window),
            LPARAM(&mut scan as *mut WindowScan as isize),
        )
    };
    scan.found
}

unsafe extern "system" fn check_window(window: HWND, data: LPARAM) -> BOOL {
    let scan = unsafe { &mut *(data.0 as *mut WindowScan) };
    scan.found = window != scan.shell && covers_screen_near_camp(window, &scan.camp);
    BOOL::from(!scan.found)
}

fn intersects(a: &RECT, b: &RECT) -> bool {
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

fn covers_screen(window: &RECT, screen: &RECT) -> bool {
    const EDGE_TOLERANCE: i32 = 1;
    window.left <= screen.left + EDGE_TOLERANCE
        && window.top <= screen.top + EDGE_TOLERANCE
        && window.right >= screen.right - EDGE_TOLERANCE
        && window.bottom >= screen.bottom - EDGE_TOLERANCE
}

fn covers_screen_near_camp(window: HWND, camp: &RECT) -> bool {
    if !unsafe { IsWindowVisible(window) }.as_bool() || unsafe { IsIconic(window) }.as_bool() {
        return false;
    }
    // Windows input surfaces such as ShellHandwritingCanvas can span an entire screen.
    let ex_style = unsafe { GetWindowLongW(window, GWL_EXSTYLE) } as u32;
    let click_through_overlay = WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0;
    if ex_style & click_through_overlay == click_through_overlay {
        return false;
    }
    let mut bounds = RECT::default();
    if unsafe { GetWindowRect(window, &mut bounds) }.is_err() || !intersects(&bounds, camp) {
        return false;
    }
    let monitor = unsafe { MonitorFromWindow(window, MONITOR_DEFAULTTONULL) };
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool()
        || !covers_screen(&bounds, &info.rcMonitor)
    {
        return false;
    }
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(window, Some(&mut process_id)) };
    if process_id == std::process::id() {
        return false;
    }
    let mut class_name = [0u16; 64];
    let length = unsafe { GetClassNameW(window, &mut class_name) } as usize;
    if matches!(
        String::from_utf16_lossy(&class_name[..length]).as_str(),
        "Progman" | "WorkerW"
    ) {
        return false;
    }
    let style = unsafe { GetWindowLongW(window, GWL_STYLE) } as u32;
    if unsafe { IsZoomed(window) }.as_bool() && style & WS_CAPTION.0 == WS_CAPTION.0 {
        return false;
    }
    let mut cloaked = 0u32;
    let _ = unsafe {
        DwmGetWindowAttribute(
            window,
            DWMWA_CLOAKED,
            (&mut cloaked as *mut u32).cast(),
            size_of::<u32>() as u32,
        )
    };
    if cloaked != 0 {
        return false;
    }
    // DWM bounds omit the invisible resize border of maximized windows.
    let _ = unsafe {
        DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut bounds as *mut RECT).cast(),
            size_of::<RECT>() as u32,
        )
    };
    covers_screen(&bounds, &info.rcMonitor) && intersects(&bounds, camp)
}
