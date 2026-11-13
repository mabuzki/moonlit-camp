use std::mem::size_of;
use windows::{
    core::HSTRING,
    Win32::{
        Graphics::Gdi::{EnumDisplayDevicesW, DISPLAY_DEVICEW, DISPLAY_DEVICE_ACTIVE},
        UI::WindowsAndMessaging::EDD_GET_DEVICE_INTERFACE_NAME,
    },
};

pub fn device_interface(display_name: &str) -> Option<String> {
    let display = HSTRING::from(display_name);
    for index in 0.. {
        let mut device = DISPLAY_DEVICEW {
            cb: size_of::<DISPLAY_DEVICEW>() as u32,
            ..Default::default()
        };
        let found = unsafe {
            EnumDisplayDevicesW(&display, index, &mut device, EDD_GET_DEVICE_INTERFACE_NAME)
        };
        if !found.as_bool() {
            return None;
        }
        if device.StateFlags.contains(DISPLAY_DEVICE_ACTIVE) && device.DeviceID[0] != 0 {
            let length = device
                .DeviceID
                .iter()
                .position(|&value| value == 0)
                .unwrap_or(device.DeviceID.len());
            return Some(String::from_utf16_lossy(&device.DeviceID[..length]));
        }
    }
    None
}
