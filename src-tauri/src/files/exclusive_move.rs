//! Publish an owned version directory without ever replacing an existing destination.
use std::path::Path;

#[cfg(windows)]
pub(crate) fn rename_new(source: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    let target = super::publish_path::target(target)?;
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { windows_sys::Win32::Storage::FileSystem::MoveFileExW(source.as_ptr(), target.as_ptr(), 0) } == 0 {
        Err(format!("无法排他发布快照版本：{}", std::io::Error::last_os_error()))
    } else { Ok(()) }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) fn rename_new(source: &Path, target: &Path) -> Result<(), String> {
    use std::os::unix::ffi::OsStrExt;
    let source = std::ffi::CString::new(source.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    let target = std::ffi::CString::new(target.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    let result = unsafe { libc::renameat2(libc::AT_FDCWD, source.as_ptr(), libc::AT_FDCWD, target.as_ptr(), libc::RENAME_NOREPLACE) };
    #[cfg(target_os = "macos")]
    let result = unsafe { libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 { Ok(()) } else { Err(format!("无法排他发布快照版本：{}", std::io::Error::last_os_error())) }
}
