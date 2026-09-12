use super::ProcessSpec;
#[cfg(all(unix, not(target_os = "macos")))]
use super::run_process;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
#[cfg(all(unix, not(target_os = "macos")))]
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

const MODE: &str = "INKSTREAM_PROCESS_FIXTURE_MODE";
const DIRECTORY: &str = "INKSTREAM_PROCESS_FIXTURE_DIRECTORY";
const PARENT: &str = "INKSTREAM_PROCESS_FIXTURE_PARENT";
const TEST_NAME: &str = "git::rebase_process::test_support::fixture_process";

pub(super) struct Temp(pub PathBuf);
impl Temp {
    pub fn new() -> Self {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("inkstream-rebase-process-{}-{nonce}", std::process::id()));
        fs::create_dir(&root).unwrap(); Self(root.canonicalize().unwrap())
    }
}
impl Drop for Temp { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

pub(super) fn spec(directory: &Path, mode: &str) -> ProcessSpec {
    ProcessSpec {
        program: std::env::current_exe().unwrap(), cwd: directory.to_path_buf(),
        args: ["--ignored", "--exact", TEST_NAME, "--nocapture"].map(Into::into).to_vec(),
        env_remove: vec![], env_set: vec![(MODE.into(), mode.into()), (DIRECTORY.into(), directory.as_os_str().to_owned()), (PARENT.into(), std::process::id().to_string().into())],
    }
}

fn spawn(directory: &Path, mode: &str, quiet: bool) -> Child {
    let spec = spec(directory, mode);
    let mut command = Command::new(spec.program);
    command.args(spec.args).current_dir(spec.cwd).envs(spec.env_set).stdin(Stdio::null());
    if quiet { command.stdout(Stdio::null()).stderr(Stdio::null()); }
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().unwrap()
}

pub(crate) struct Sentinel { child: Child, directory: PathBuf }
impl Sentinel {
    pub fn new(directory: &Path) -> Self { Self { child: spawn(directory, "sentinel", true), directory: directory.to_path_buf() } }
    pub fn alive(&mut self) -> bool { self.child.try_wait().unwrap().is_none() }
}
impl Drop for Sentinel {
    fn drop(&mut self) {
        let _ = fs::write(self.directory.join("release-sentinel"), "done");
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.child.try_wait().ok().flatten().is_none() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(10)); }
        if self.child.try_wait().ok().flatten().is_none() { let _ = self.child.kill(); }
        let deadline = Instant::now() + Duration::from_secs(2);
        while self.child.try_wait().ok().flatten().is_none() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(10)); }
    }
}

pub(crate) fn wait_pid(directory: &Path, name: &str) -> u32 {
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        if let Ok(value) = fs::read_to_string(directory.join(format!("{name}.pid"))) {
            if let Some(pid) = value.split_whitespace().next().and_then(|value| value.parse().ok()) { return pid; }
        }
        assert!(Instant::now() < deadline, "fixture {name} never became ready");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[cfg(windows)]
pub(crate) struct Watch(std::os::windows::io::OwnedHandle);
#[cfg(windows)]
impl Watch {
    pub fn new(pid: u32) -> Self {
        use std::os::windows::io::FromRawHandle;
        use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        assert!(!handle.is_null(), "cannot retain fixture process {pid}");
        Self(unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(handle) })
    }
    pub fn alive(&self) -> bool {
        use std::os::windows::io::AsRawHandle;
        let mut code = 0;
        assert_ne!(unsafe { windows_sys::Win32::System::Threading::GetExitCodeProcess(self.0.as_raw_handle(), &mut code) }, 0);
        code == 259
    }
}
#[cfg(target_os = "macos")]
#[path = "rebase_process_watch_darwin.rs"]
mod darwin_watch;
#[cfg(target_os = "macos")]
pub(crate) use darwin_watch::Watch;

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) struct Watch(u32);
#[cfg(all(unix, not(target_os = "macos")))]
impl Watch {
    pub fn new(pid: u32) -> Self { Self(pid) }
    pub fn alive(&self) -> bool {
        let query = ProcessSpec {
            program: PathBuf::from("/bin/ps"), cwd: std::env::temp_dir(),
            args: vec!["-p".into(), self.0.to_string().into(), "-o".into(), "stat=".into()], env_remove: vec![], env_set: vec![],
        };
        let output = run_process(&query, &AtomicBool::new(false), Duration::from_secs(2)).unwrap();
        !output.stdout.trim().is_empty() && !output.stdout.trim_start().starts_with('Z')
    }
}

/// The parent test launches only this ignored helper. Every helper also has its own final deadline.
#[test]
#[ignore = "invoked only by the bounded-process fixtures"]
fn fixture_process() {
    let Ok(mode) = std::env::var(MODE) else { return; };
    let directory = PathBuf::from(std::env::var_os(DIRECTORY).unwrap());
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
    fs::write(directory.join(format!("{mode}.pid")), format!("{} {} {stamp}\n", std::process::id(), std::env::var(PARENT).unwrap_or_default())).unwrap();
    let _child = match mode.as_str() {
        "exit-success" => return,
        "exit-failure" => std::process::exit(7),
        "root" => Some(spawn(&directory, "child", false)),
        "child" => Some(spawn(&directory, "grandchild", false)),
        "pipe-parent" => {
            let child = spawn(&directory, "pipe-child", false);
            wait_pid(&directory, "pipe-child");
            let observed = Instant::now() + Duration::from_secs(4);
            while !directory.join("observed-pipe-child").exists() {
                assert!(Instant::now() < observed, "parent test did not retain the child identity");
                std::thread::sleep(Duration::from_millis(10));
            }
            let noise = vec![b'x'; super::CAPTURE_LIMIT * 4];
            std::io::stdout().write_all(&noise).unwrap();
            std::io::stdout().write_all(b"\nFINAL_STDOUT\n").unwrap();
            std::io::stderr().write_all(&noise).unwrap();
            std::io::stderr().write_all(b"\nFINAL_STDERR\n").unwrap();
            drop(child); // Its inherited pipe must not keep the bounded runner waiting for EOF.
            return;
        }
        "progress-parent" => {
            std::io::stdout().write_all(b"STDOUT_ONLY\n").unwrap();
            std::io::stderr().write_all(b"first-progress\r").unwrap();
            let deadline = Instant::now() + Duration::from_secs(2);
            while !directory.join("progress-observed").exists() {
                assert!(Instant::now() < deadline, "progress was not delivered while the child was running");
                std::thread::sleep(Duration::from_millis(10));
            }
            std::io::stderr().write_all(b"last-progress").unwrap();
            return;
        }
        _ => None,
    };
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if mode == "sentinel" && directory.join("release-sentinel").exists() { return; }
        std::thread::sleep(Duration::from_millis(10));
    }
}
