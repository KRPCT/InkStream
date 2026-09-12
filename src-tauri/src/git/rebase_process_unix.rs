use super::{stop_reason, ProcessOutput, ProcessSpec, Progress, Tail, CLEANUP_LIMIT, POLL};
use std::io::Read;
use std::os::fd::AsRawFd;
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
#[path = "rebase_process_darwin.rs"]
mod darwin;

fn nonblocking(pipe: &impl AsRawFd) -> Result<(), String> {
    let fd = pipe.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

fn drain(pipe: &mut impl Read, tail: &mut Tail, mut progress: Option<&mut Progress<'_>>) -> Result<(), String> {
    let mut bytes = [0; 8192];
    for _ in 0..8 {
        match pipe.read(&mut bytes) {
            Ok(0) => return Ok(()),
            Ok(size) => {
                tail.push(&bytes[..size]);
                if let Some(observer) = progress.as_deref_mut() { observer.push(&bytes[..size], Instant::now()); }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

/// Observe without reaping: the root PID cannot be reused before its owned group is terminated.
fn exited(pid: u32) -> Result<bool, String> {
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    if unsafe { libc::waitid(libc::P_PID, pid, &mut info, libc::WEXITED | libc::WNOHANG | libc::WNOWAIT) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::Interrupted { return Ok(false); }
        return Err(error.to_string());
    }
    Ok(unsafe { info.si_pid() } == pid as i32)
}

fn signal_group(pid: u32, signal: i32) -> Result<(), String> {
    if unsafe { libc::kill(-(pid as i32), signal) } == 0 { return Ok(()); }
    let error = std::io::Error::last_os_error();
    // Darwin skips zombies in killpg1 and returns EPERM when none remain signalable.
    // Keep the root unreaped and independently verify every remaining member before
    // accepting that result; a real permission failure must still stop cleanup.
    #[cfg(target_os = "macos")]
    if error.raw_os_error() == Some(libc::EPERM) && exited(pid)? && darwin::group_has_no_live_members(pid)? {
        return Ok(());
    }
    if error.raw_os_error() == Some(libc::ESRCH) { Ok(()) } else { Err(error.to_string()) }
}

fn cleanup(child: &mut Child) -> Result<ExitStatus, String> {
    let pid = child.id();
    let deadline = Instant::now() + CLEANUP_LIMIT;
    if !exited(pid)? {
        signal_group(pid, libc::SIGTERM)?;
        let grace = Instant::now() + Duration::from_millis(200);
        while !exited(pid)? && Instant::now() < grace { std::thread::sleep(POLL); }
    }
    // The unreaped root still reserves the process-group id, even if only a pipe-holding child remains.
    signal_group(pid, libc::SIGKILL)?;
    while !exited(pid)? {
        if Instant::now() >= deadline { return Err("自有 Git 进程组未在回收期限内退出".into()); }
        std::thread::sleep(POLL);
    }
    // Never signal the group again after this reap; no PID-reuse window is left open.
    child.try_wait().map_err(|e| e.to_string())?.ok_or_else(|| "Git 已报告退出，但回收状态仍不可用".into())
}

pub(super) fn run(spec: &ProcessSpec, cancel: &AtomicBool, deadline: Instant, progress: &mut Progress<'_>) -> Result<ProcessOutput, String> {
    let mut command = Command::new(&spec.program);
    command.args(&spec.args).current_dir(&spec.cwd).process_group(0)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for key in &spec.env_remove { command.env_remove(key); }
    for (key, value) in &spec.env_set { command.env(key, value); }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let mut out_pipe = child.stdout.take().ok_or("Git stdout 管道不可用")?;
    let mut err_pipe = child.stderr.take().ok_or("Git stderr 管道不可用")?;
    let (mut stdout, mut stderr) = (Tail::default(), Tail::default());
    let mut interruption = None;
    let mut pipes_ready = false;
    let run_result = (|| {
        nonblocking(&out_pipe)?;
        nonblocking(&err_pipe)?;
        pipes_ready = true;
        loop {
            drain(&mut out_pipe, &mut stdout, None)?;
            drain(&mut err_pipe, &mut stderr, Some(&mut *progress))?;
            progress.tick(Instant::now());
            if exited(child.id())? { return Ok::<(), String>(()); }
            if let Some(reason) = stop_reason(cancel, deadline) { interruption = Some(reason); return Ok(()); }
            std::thread::sleep(POLL);
        }
    })();
    if interruption.is_some() && exited(child.id()).unwrap_or(false) { interruption = None; }
    let cleaned = cleanup(&mut child);
    // Both handles remain nonblocking: a detached external daemon holding a pipe cannot make us wait for EOF.
    if pipes_ready {
        let _ = drain(&mut out_pipe, &mut stdout, None);
        let _ = drain(&mut err_pipe, &mut stderr, Some(&mut *progress));
    }
    progress.finish();
    let (exit_code, cleanup_error) = match cleaned {
        Ok(status) => (status.code().or_else(|| status.signal().map(|s| -s)), None),
        Err(error) => (None, Some(error)),
    };
    if let Err(error) = run_result { return Err(format!("Git 进程读取失败：{error}{}", cleanup_error.as_ref().map(|e| format!("；回收失败：{e}")).unwrap_or_default())); }
    Ok(ProcessOutput { exit_code, stdout: stdout.text(), stderr: stderr.text(), interruption, cleanup_error })
}
