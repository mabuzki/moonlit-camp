use std::{
    env,
    error::Error,
    ffi::OsString,
    fs, io,
    os::windows::ffi::OsStringExt,
    path::{Path, PathBuf},
};
use windows::{
    core::{Interface, HSTRING},
    Win32::{
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile,
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        },
        UI::Shell::{
            FOLDERID_Startup, IShellLinkW, SHGetKnownFolderPath, ShellLink, KF_FLAG_DONT_VERIFY,
        },
    },
};

pub fn shortcut_path() -> windows::core::Result<PathBuf> {
    let folder = unsafe {
        let path = SHGetKnownFolderPath(&FOLDERID_Startup, KF_FLAG_DONT_VERIFY, None)?;
        let folder = OsString::from_wide(path.as_wide());
        CoTaskMemFree(Some(path.as_ptr().cast()));
        folder
    };
    Ok(PathBuf::from(folder).join("Moonlit Camp.lnk"))
}

pub fn set_enabled(shortcut: &Path, enabled: bool, description: &str) -> Result<(), Box<dyn Error>> {
    if !enabled {
        return match fs::remove_file(shortcut) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        };
    }

    let exe = env::current_exe()?;
    let working_dir = exe.parent().ok_or("Application directory unavailable")?;
    let startup_dir = shortcut.parent().ok_or("Windows startup folder unavailable")?;
    fs::create_dir_all(startup_dir)?;

    // Keep the COM interfaces inside the closure so they drop before CoUninitialize.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let saved = (|| -> windows::core::Result<()> {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&HSTRING::from(exe.as_os_str()))?;
            link.SetWorkingDirectory(&HSTRING::from(working_dir.as_os_str()))?;
            link.SetDescription(&HSTRING::from(description))?;
            link.cast::<IPersistFile>()?
                .Save(&HSTRING::from(shortcut.as_os_str()), true)
        })();
        CoUninitialize();
        saved?;
    }
    Ok(())
}
