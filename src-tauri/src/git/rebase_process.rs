//! Bounded, private process execution for rebase. Output and cleanup both have limits.
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[path = "rebase_process_progress.rs"]
mod progress;
use progress::Progress;

#[cfg(windows)]
#[path = "rebase_process_windows.rs"]
mod platform;

#[cfg(test)]
#[path = "rebase_process_fixture.rs"]
mod test_support;
#[cfg(test)]
#[path = "rebase_process_tests.rs"]
mod tests;
#[cfg(unix)]
#[path = "rebase_process_unix.rs"]
mod platform;

pub(super) struct ProcessSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    pub env_remove: Vec<OsString>,
    pub env_set: Vec<(OsString, OsString)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum StopReason { Cancelled, TimedOut }

#[derive(Debug)]
pub(super) struct ProcessOutput {
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub interruption: Option<StopReason>,
    pub cleanup_error: Option<String>,
}

pub(super) const CAPTURE_LIMIT: usize = 64 * 1024;
const POLL: Duration = Duration::from_millis(10);
const CLEANUP_LIMIT: Duration = Duration::from_secs(3);

#[derive(Default)]
struct Tail(Vec<u8>);
impl Tail {
    fn push(&mut self, bytes: &[u8]) {
        let bytes = &bytes[bytes.len().saturating_sub(CAPTURE_LIMIT)..];
        let excess = (self.0.len() + bytes.len()).saturating_sub(CAPTURE_LIMIT);
        self.0.drain(..excess);
        self.0.extend_from_slice(bytes);
    }
    fn text(self) -> String {
        let mut text = String::from_utf8_lossy(&self.0).into_owned();
        let mut start = text.len().saturating_sub(CAPTURE_LIMIT);
        while !text.is_char_boundary(start) { start += 1; }
        if start > 0 { text.drain(..start); }
        text
    }
}

fn stop_reason(cancel: &AtomicBool, deadline: Instant) -> Option<StopReason> {
    if cancel.load(Ordering::Acquire) { Some(StopReason::Cancelled) }
    else if Instant::now() >= deadline { Some(StopReason::TimedOut) }
    else { None }
}

pub(super) fn run_process(spec: &ProcessSpec, cancel: &AtomicBool, timeout: Duration) -> Result<ProcessOutput, String> {
    run_process_with_progress(spec, cancel, timeout, &mut |_| {})
}

/// Reports bounded stderr lines at most every 100ms, with one final flush before returning.
/// The observer must return promptly; callers redact credentials before forwarding to the UI.
pub(super) fn run_process_with_progress(
    spec: &ProcessSpec,
    cancel: &AtomicBool,
    timeout: Duration,
    callback: &mut dyn FnMut(&str),
) -> Result<ProcessOutput, String> {
    if !spec.program.is_absolute() || !spec.cwd.is_absolute() { return Err("进程路径与工作目录必须是绝对路径".into()); }
    let deadline = Instant::now() + timeout;
    if let Some(interruption) = stop_reason(cancel, deadline) {
        return Ok(ProcessOutput { exit_code: None, stdout: String::new(), stderr: String::new(), interruption: Some(interruption), cleanup_error: None });
    }
    platform::run(spec, cancel, deadline, &mut Progress::new(callback))
}
