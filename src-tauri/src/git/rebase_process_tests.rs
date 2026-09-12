use super::{run_process, ProcessOutput, StopReason, CAPTURE_LIMIT};
use super::run_process_with_progress;
use super::test_support::{spec, wait_pid, Sentinel, Temp, Watch};
use std::sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc};
use std::time::{Duration, Instant};

struct Running {
    cancel: Arc<AtomicBool>,
    result: mpsc::Receiver<Result<ProcessOutput, String>>,
}
impl Running {
    fn start(directory: &std::path::Path, mode: &str, timeout: Duration) -> Self {
        let spec = spec(directory, mode);
        let cancel = Arc::new(AtomicBool::new(false));
        let control = cancel.clone();
        let (send, result) = mpsc::channel();
        std::thread::spawn(move || { let _ = send.send(run_process(&spec, &control, timeout)); });
        Self { cancel, result }
    }
    fn finish(&self) -> ProcessOutput { self.result.recv_timeout(Duration::from_secs(9)).expect("bounded runner did not return").unwrap() }
    fn wait_pid(&self, directory: &std::path::Path, name: &str) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(4);
        loop {
            if let Ok(value) = std::fs::read_to_string(directory.join(format!("{name}.pid"))) {
                if let Some(pid) = value.split_whitespace().next().and_then(|value| value.parse().ok()) { return pid; }
            }
            if let Ok(result) = self.result.try_recv() { panic!("fixture {name} exited before readiness: {result:?}"); }
            if Instant::now() >= deadline {
                self.cancel.store(true, Ordering::Release);
                panic!("fixture {name} never became ready; runner={:?}", self.finish());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }
}
impl Drop for Running {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
        let _ = self.result.recv_timeout(Duration::from_secs(4));
    }
}

#[test]
fn ordinary_root_exit_preserves_success_and_failure_without_cleanup_errors() {
    let directory = Temp::new();
    for (mode, code) in [("exit-success", 0), ("exit-failure", 7)] {
        let output = run_process(&spec(&directory.0, mode), &AtomicBool::new(false), Duration::from_secs(5)).unwrap();
        assert_eq!(output.exit_code, Some(code), "{output:?}");
        assert!(output.interruption.is_none(), "{output:?}");
        assert!(output.cleanup_error.is_none(), "{output:?}");
    }
}

#[test]
fn cancellation_and_timeout_stop_owned_descendants_but_not_a_sentinel() {
    for timeout in [false, true] {
        let directory = Temp::new();
        let mut sentinel = Sentinel::new(&directory.0);
        wait_pid(&directory.0, "sentinel");
        let running = Running::start(&directory.0, "root", Duration::from_secs(if timeout { 5 } else { 10 }));
        let watched: Vec<_> = ["root", "child", "grandchild"].map(|name| Watch::new(running.wait_pid(&directory.0, name))).into_iter().collect();
        assert!(watched.iter().all(|process| process.alive()), "exit observers must report live fixtures before cancellation");
        if !timeout { running.cancel.store(true, Ordering::Release); }
        let output = running.finish();
        assert_eq!(output.interruption, Some(if timeout { StopReason::TimedOut } else { StopReason::Cancelled }));
        assert!(output.cleanup_error.is_none(), "{:?}", output.cleanup_error);
        assert!(watched.iter().all(|process| !process.alive()));
        #[cfg(target_os = "macos")]
        assert!(watched.iter().all(|process| !process.alive()), "consuming a one-shot exit event must not report the process alive again");
        assert!(sentinel.alive());
    }
}

#[test]
fn parent_exit_with_pipe_holding_child_does_not_wait_for_eof_or_grow_capture() {
    let directory = Temp::new();
    let start = Instant::now();
    let running = Running::start(&directory.0, "pipe-parent", Duration::from_secs(8));
    let child = Watch::new(running.wait_pid(&directory.0, "pipe-child"));
    assert!(child.alive(), "pipe holder must be alive before the parent is released");
    std::fs::write(directory.0.join("observed-pipe-child"), "ready").unwrap();
    let output = running.finish();
    assert_eq!(output.exit_code, Some(0));
    assert!(output.interruption.is_none());
    assert!(output.cleanup_error.is_none(), "{:?}", output.cleanup_error);
    assert!(start.elapsed() < Duration::from_secs(7));
    assert!(output.stdout.len() <= CAPTURE_LIMIT && output.stderr.len() <= CAPTURE_LIMIT);
    assert!(output.stdout.contains("FINAL_STDOUT") && output.stderr.contains("FINAL_STDERR"));
    assert!(!child.alive());
}

#[test]
fn stderr_progress_arrives_before_child_exit_and_flushes_the_final_fragment() {
    let directory = Temp::new();
    let mut lines = Vec::new();
    let output = run_process_with_progress(&spec(&directory.0, "progress-parent"), &AtomicBool::new(false), Duration::from_secs(5), &mut |line| {
        lines.push(line.to_string());
        if line == "first-progress" { std::fs::write(directory.0.join("progress-observed"), "received").unwrap(); }
    }).unwrap();
    assert_eq!(output.exit_code, Some(0), "{output:?}");
    assert_eq!(lines, vec!["first-progress", "last-progress"]);
    assert!(output.stdout.contains("STDOUT_ONLY"));
    assert!(output.cleanup_error.is_none());
}

#[test]
fn invalid_utf8_cannot_expand_the_returned_tail_past_its_budget() {
    let mut tail = super::Tail::default();
    tail.push(&vec![0xff; CAPTURE_LIMIT]);
    tail.push(b"last-message");
    let text = tail.text();
    assert!(text.len() <= CAPTURE_LIMIT);
    assert!(text.ends_with("last-message"));
}
