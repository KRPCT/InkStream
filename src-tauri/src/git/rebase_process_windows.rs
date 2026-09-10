use super::{stop_reason, ProcessOutput, ProcessSpec, Progress, Tail, CLEANUP_LIMIT, POLL};
use std::fs::File;
use std::io::Read;
use std::mem::size_of;
use std::os::windows::io::AsRawHandle;
use std::ptr::{null_mut};
use std::sync::atomic::AtomicBool;
use std::time::Instant;
use windows_sys::Win32::Foundation::{HANDLE, ERROR_BROKEN_PIPE, ERROR_NO_DATA, WAIT_FAILED, WAIT_OBJECT_0};
use windows_sys::Win32::System::JobObjects::{QueryInformationJobObject, TerminateJobObject, JobObjectBasicAccountingInformation, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION};
use windows_sys::Win32::System::Pipes::PeekNamedPipe;
use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};

#[path = "rebase_process_windows_spawn.rs"]
mod launch;

fn drain(file: &mut File, tail: &mut Tail, mut progress: Option<&mut Progress<'_>>) -> Result<(), String> {
    let mut bytes = [0; 8192];
    for _ in 0..8 {
        let mut available = 0;
        if unsafe { PeekNamedPipe(file.as_raw_handle(), null_mut(), 0, null_mut(), &mut available, null_mut()) } == 0 {
            let error = std::io::Error::last_os_error();
            if matches!(error.raw_os_error(), Some(code) if code == ERROR_BROKEN_PIPE as i32 || code == ERROR_NO_DATA as i32) { return Ok(()); }
            return Err(error.to_string());
        }
        if available == 0 { return Ok(()); }
        let cap = bytes.len().min(available as usize);
        let count = file.read(&mut bytes[..cap]).map_err(|e| e.to_string())?;
        if count == 0 { return Ok(()); }
        tail.push(&bytes[..count]);
        if let Some(observer) = progress.as_deref_mut() { observer.push(&bytes[..count], Instant::now()); }
    }
    Ok(())
}

fn exit_code(process: HANDLE) -> Result<Option<i32>, String> {
    match unsafe { WaitForSingleObject(process, 0) } {
        WAIT_OBJECT_0 => {
            let mut code = 0;
            if unsafe { GetExitCodeProcess(process, &mut code) } == 0 { return Err(std::io::Error::last_os_error().to_string()); }
            Ok(Some(code as i32))
        }
        WAIT_FAILED => Err(std::io::Error::last_os_error().to_string()),
        _ => Ok(None),
    }
}

fn active(job: HANDLE) -> Result<u32, String> {
    let mut accounting = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
    if unsafe { QueryInformationJobObject(job, JobObjectBasicAccountingInformation, (&mut accounting as *mut JOBOBJECT_BASIC_ACCOUNTING_INFORMATION).cast(), size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32, null_mut()) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(accounting.ActiveProcesses)
}

fn cleanup(job: HANDLE, process: HANDLE) -> Result<(), String> {
    if active(job)? == 0 && exit_code(process)?.is_some() { return Ok(()); }
    if unsafe { TerminateJobObject(job, 1) } == 0 { return Err(std::io::Error::last_os_error().to_string()); }
    let deadline = Instant::now() + CLEANUP_LIMIT;
    while active(job)? > 0 || exit_code(process)?.is_none() {
        if Instant::now() >= deadline { return Err("自有 Git 进程组未在回收期限内退出".into()); }
        std::thread::sleep(POLL);
    }
    Ok(())
}

pub(super) fn run(spec: &ProcessSpec, cancel: &AtomicBool, deadline: Instant, progress: &mut Progress<'_>) -> Result<ProcessOutput, String> {
    let mut child = launch::spawn(spec)?;
    let (mut stdout, mut stderr) = (Tail::default(), Tail::default());
    let mut interruption = None;
    let mut read_error = None;
    let mut code = None;
    loop {
        if let Err(error) = drain(&mut child.stdout, &mut stdout, None).and_then(|_| drain(&mut child.stderr, &mut stderr, Some(&mut *progress))) { read_error = Some(error); break; }
        progress.tick(Instant::now());
        match exit_code(child.process.as_raw_handle()) {
            Ok(Some(value)) => { code = Some(value); break; }
            Err(error) => { read_error = Some(error); break; }
            Ok(None) => {}
        }
        if let Some(reason) = stop_reason(cancel, deadline) { interruption = Some(reason); break; }
        std::thread::sleep(POLL);
    }
    if interruption.is_some() {
        if let Ok(Some(value)) = exit_code(child.process.as_raw_handle()) { code = Some(value); interruption = None; }
    }
    let cleanup_error = cleanup(child.job.as_raw_handle(), child.process.as_raw_handle()).err();
    if code.is_none() { code = exit_code(child.process.as_raw_handle()).ok().flatten(); }
    let _ = drain(&mut child.stdout, &mut stdout, None);
    let _ = drain(&mut child.stderr, &mut stderr, Some(&mut *progress));
    progress.finish();
    if let Some(error) = read_error { return Err(format!("Git 进程读取失败：{error}{}", cleanup_error.as_ref().map(|e| format!("；回收失败：{e}")).unwrap_or_default())); }
    Ok(ProcessOutput { exit_code: code, stdout: stdout.text(), stderr: stderr.text(), interruption, cleanup_error })
}
