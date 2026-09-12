use super::super::ProcessSpec;
use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::mem::{size_of, size_of_val};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::io::{AsRawHandle, FromRawHandle, IntoRawHandle, OwnedHandle};
use std::ptr::{null, null_mut};
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::System::JobObjects::{CreateJobObjectW, IsProcessInJob, SetInformationJobObject, JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE};
use windows_sys::Win32::System::Pipes::CreatePipe;
use windows_sys::Win32::System::Threading::{CreateProcessW, DeleteProcThreadAttributeList, InitializeProcThreadAttributeList, TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, STARTF_USESTDHANDLES, STARTUPINFOEXW};

pub(super) struct Child {
    pub job: OwnedHandle,
    pub process: OwnedHandle,
    pub stdout: File,
    pub stderr: File,
}

fn last_error() -> String { std::io::Error::last_os_error().to_string() }

fn wide(value: &OsStr) -> Result<Vec<u16>, String> {
    let mut bytes: Vec<u16> = value.encode_wide().collect();
    if bytes.contains(&0) { return Err("进程参数包含无效的 NUL 字符".into()); }
    bytes.push(0);
    Ok(bytes)
}

fn process_directory(value: &OsStr) -> OsString {
    let units: Vec<u16> = value.encode_wide().collect();
    let unc: Vec<u16> = r"\\?\UNC\".encode_utf16().collect();
    let verbatim: Vec<u16> = r"\\?\".encode_utf16().collect();
    if units.starts_with(&unc) {
        let mut normal = vec![b'\\' as u16, b'\\' as u16];
        normal.extend_from_slice(&units[unc.len()..]);
        OsString::from_wide(&normal)
    } else if units.starts_with(&verbatim) {
        OsString::from_wide(&units[verbatim.len()..])
    } else { value.to_owned() }
}

fn directory_argument(path: &Path) -> Result<Vec<u16>, String> {
    // A verbatim lpCurrentDirectory can stall a Windows child before its entry point. Keep the
    // canonical filesystem identity inside ProcessSpec; translate only this Win32 startup argument.
    let normal = PathBuf::from(process_directory(path.as_os_str()));
    if !normal.is_absolute() { return Err("Git 工作目录必须是绝对 Win32 或 UNC 路径".into()); }
    if normal != path {
        let actual = normal.canonicalize().map_err(|e| format!("无法解析进程工作目录：{e}"))?;
        let original = path.canonicalize().map_err(|e| format!("无法解析原工作目录：{e}"))?;
        if actual != original { return Err("工作目录转换会改变实际路径，未启动 Git 进程".into()); }
    }
    wide(normal.as_os_str())
}

/// MS C-runtime argument quoting; CreateProcess receives an explicit application path, never a shell.
fn quote(value: &OsStr) -> Result<Vec<u16>, String> {
    let bytes = wide(value)?;
    let mut result = vec![b'"' as u16];
    let mut slashes = 0;
    for &unit in &bytes[..bytes.len() - 1] {
        if unit == b'\\' as u16 { slashes += 1; continue; }
        result.extend(std::iter::repeat_n(b'\\' as u16, if unit == b'"' as u16 { slashes * 2 + 1 } else { slashes }));
        result.push(unit);
        slashes = 0;
    }
    result.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
    result.push(b'"' as u16);
    Ok(result)
}

fn environment(spec: &ProcessSpec) -> Result<Vec<u16>, String> {
    let mut vars = BTreeMap::new();
    for (key, value) in std::env::vars_os() {
        vars.insert(key.to_string_lossy().to_uppercase(), (key, value));
    }
    for key in &spec.env_remove { vars.remove(&key.to_string_lossy().to_uppercase()); }
    for (key, value) in &spec.env_set {
        vars.insert(key.to_string_lossy().to_uppercase(), (key.clone(), value.clone()));
    }
    let mut result = Vec::new();
    for (_, (key, value)) in vars {
        let mut pair = key;
        pair.push("="); pair.push(value);
        result.extend(wide(&pair)?);
    }
    result.push(0);
    if result.len() == 1 { result.push(0); }
    Ok(result)
}

fn pipe() -> Result<(OwnedHandle, OwnedHandle), String> {
    let attributes = SECURITY_ATTRIBUTES { nLength: size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: null_mut(), bInheritHandle: 1 };
    let (mut read, mut write) = (null_mut(), null_mut());
    if unsafe { CreatePipe(&mut read, &mut write, &attributes, 0) } == 0 { return Err(last_error()); }
    Ok(unsafe { (OwnedHandle::from_raw_handle(read), OwnedHandle::from_raw_handle(write)) })
}

struct Attributes { storage: Vec<u128>, initialized: bool }
impl Attributes {
    fn new() -> Result<Self, String> {
        let mut bytes = 0;
        unsafe { InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut bytes); }
        if bytes == 0 { return Err(last_error()); }
        let mut attributes = Self { storage: vec![0; bytes.div_ceil(size_of::<u128>())], initialized: false };
        if unsafe { InitializeProcThreadAttributeList(attributes.ptr(), 2, 0, &mut bytes) } == 0 { return Err(last_error()); }
        attributes.initialized = true;
        Ok(attributes)
    }
    fn ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST { self.storage.as_mut_ptr().cast() }
    fn set(&mut self, kind: u32, values: &[HANDLE]) -> Result<(), String> {
        if unsafe { UpdateProcThreadAttribute(self.ptr(), 0, kind as usize, values.as_ptr().cast(), size_of_val(values), null_mut(), null()) } == 0 {
            return Err(last_error());
        }
        Ok(())
    }
}
impl Drop for Attributes {
    fn drop(&mut self) { if self.initialized { unsafe { DeleteProcThreadAttributeList(self.ptr()); } } }
}

pub(super) fn spawn(spec: &ProcessSpec) -> Result<Child, String> {
    let application = wide(spec.program.as_os_str())?;
    let cwd = directory_argument(&spec.cwd)?;
    let environment = environment(spec)?;
    let mut command = quote(spec.program.as_os_str())?;
    for argument in &spec.args { command.push(b' ' as u16); command.extend(quote(argument)?); }
    command.push(0);
    let job = unsafe { CreateJobObjectW(null(), null()) };
    if job.is_null() { return Err(last_error()); }
    let job = unsafe { OwnedHandle::from_raw_handle(job) };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if unsafe { SetInformationJobObject(job.as_raw_handle(), JobObjectExtendedLimitInformation, (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), size_of_val(&limits) as u32) } == 0 { return Err(last_error()); }
    let (stdin, stdin_writer) = pipe()?;
    drop(stdin_writer); // No interactive stdin; the child immediately observes EOF.
    let (stdout, stdout_writer) = pipe()?;
    let (stderr, stderr_writer) = pipe()?;
    let jobs = [job.as_raw_handle()];
    let handles = [stdin.as_raw_handle(), stdout_writer.as_raw_handle(), stderr_writer.as_raw_handle()];
    let mut attributes = Attributes::new()?;
    attributes.set(PROC_THREAD_ATTRIBUTE_JOB_LIST, &jobs)?;
    attributes.set(PROC_THREAD_ATTRIBUTE_HANDLE_LIST, &handles)?;
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = stdin.as_raw_handle();
    startup.StartupInfo.hStdOutput = stdout_writer.as_raw_handle();
    startup.StartupInfo.hStdError = stderr_writer.as_raw_handle();
    startup.lpAttributeList = attributes.ptr();
    let mut info = PROCESS_INFORMATION::default();
    if unsafe { CreateProcessW(application.as_ptr(), command.as_mut_ptr(), null(), null(), 1, CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT, environment.as_ptr().cast(), cwd.as_ptr(), &startup.StartupInfo, &mut info) } == 0 { return Err(last_error()); }
    let process = unsafe { OwnedHandle::from_raw_handle(info.hProcess) };
    drop(unsafe { OwnedHandle::from_raw_handle(info.hThread) });
    let mut belongs = 0;
    if unsafe { IsProcessInJob(process.as_raw_handle(), job.as_raw_handle(), &mut belongs) } == 0 || belongs == 0 {
        // Retain the exact process handle through fallback cleanup; never terminate a PID by name.
        let terminated = unsafe { TerminateProcess(process.as_raw_handle(), 1) } != 0;
        let exited = unsafe { WaitForSingleObject(process.as_raw_handle(), 3000) } == 0;
        return Err(if terminated && exited { "创建的 Git 进程未加入专属作业组，已停止启动" } else { "Git 进程作业组校验失败，且未能确认该进程退出" }.into());
    }
    drop(stdout_writer); drop(stderr_writer); drop(stdin);
    Ok(Child { job, process, stdout: unsafe { File::from_raw_handle(stdout.into_raw_handle()) }, stderr: unsafe { File::from_raw_handle(stderr.into_raw_handle()) } })
}

#[cfg(test)]
mod tests {
    use super::process_directory;
    use std::ffi::{OsStr, OsString};

    #[test]
    fn child_directory_translates_drive_and_unc_without_changing_unicode() {
        for (input, expected) in [
            (r"D:\稿件\Café", r"D:\稿件\Café"),
            (r"\\?\D:\稿件\Café", r"D:\稿件\Café"),
            (r"\\?\UNC\server\share\稿件", r"\\server\share\稿件"),
        ] {
            assert_eq!(process_directory(OsStr::new(input)), OsString::from(expected));
        }
    }
}
