use super::*;
use serde_json::json;
use std::cell::Cell;
use std::path::PathBuf;
use std::sync::atomic::AtomicUsize;
use std::time::Instant;

const ID: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const URL: &str = "ssh://fixture.invalid/repository";

struct Fixture {
    root: PathBuf,
    target: PathBuf,
    registry: Arc<state::Registry>,
    git: PathBuf,
    shell: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "inkstream-clone-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&root).unwrap();
        let source = git2::Repository::init_bare(root.join("source.git")).unwrap();
        let blob = source.blob(b"# cloned fixture\n").unwrap();
        let tree_oid = {
            let mut tree = source.treebuilder(None).unwrap();
            tree.insert("README.md", blob, 0o100644).unwrap();
            tree.write().unwrap()
        };
        let tree = source.find_tree(tree_oid).unwrap();
        let signature = git2::Signature::now("Clone fixture", "fixture@example.invalid").unwrap();
        source
            .commit(Some("HEAD"), &signature, &signature, "fixture", &tree, &[])
            .unwrap();
        drop(tree);
        drop(source);
        std::fs::write(root.join("user-file.md"), b"preserve neighbor").unwrap();
        std::fs::write(root.join("config"), b"").unwrap();
        std::fs::write(
            root.join("transport.sh"),
            r#"#!/bin/sh
printf 'fixture-start\n' >&2
printf 'started' > "$INKSTREAM_CLONE_MARKER"
case "$INKSTREAM_CLONE_MODE" in
  fail) printf 'fixture permission denied\n' >&2; exit 37 ;;
  wait) i=0; while test "$i" -lt 15; do sleep 1; i=$((i+1)); done; exit 71 ;;
  gated)
    i=0
    while ! test -f "$INKSTREAM_CLONE_RELEASE"; do
      test "$i" -lt 100 || exit 72
      sleep 0.05
      i=$((i+1))
    done
    ;;
esac
exec "$INKSTREAM_CLONE_GIT" upload-pack "$INKSTREAM_CLONE_SOURCE"
"#,
        )
        .unwrap();
        let git = super::super::rebase::git_executable().unwrap();
        #[cfg(windows)]
        let shell = git
            .ancestors()
            .take(5)
            .flat_map(|ancestor| {
                [
                    ancestor.join("bin/sh.exe"),
                    ancestor.join("usr/bin/sh.exe"),
                    ancestor.join("sh.exe"),
                ]
            })
            .find(|candidate| candidate.is_file())
            .expect("Git for Windows must include its shell for the local SSH fixture");
        #[cfg(not(windows))]
        let shell = PathBuf::from("/bin/sh");
        Self {
            target: root.join("中文书稿"),
            root,
            git,
            shell,
            registry: Arc::new(state::Registry::default()),
        }
    }

    fn request(&self) -> RequestData {
        RequestData {
            url: URL.into(),
            destination: display_path(&self.target),
            request_id: ID.into(),
            options: options("ssh", ""),
        }
    }
    fn runtime(&self, mode: &str) -> Runtime {
        Runtime {
            git: self.git.clone(),
            timeout: Duration::from_secs(8),
            environment: vec![
                (
                    "GIT_CONFIG_GLOBAL".into(),
                    display_path(&self.root.join("config")).into(),
                ),
                ("GIT_CONFIG_NOSYSTEM".into(), "1".into()),
                ("GIT_SSH_VARIANT".into(), "ssh".into()),
                (
                    "GIT_SSH_COMMAND".into(),
                    format!(
                        "{} {}",
                        shell_quote(&display_path(&self.shell)),
                        shell_quote(&display_path(&self.root.join("transport.sh")))
                    )
                    .into(),
                ),
                ("INKSTREAM_CLONE_GIT".into(), display_path(&self.git).into()),
                (
                    "INKSTREAM_CLONE_SOURCE".into(),
                    display_path(&self.root.join("source.git")).into(),
                ),
                (
                    "INKSTREAM_CLONE_MARKER".into(),
                    display_path(&self.root.join("transport-started")).into(),
                ),
                (
                    "INKSTREAM_CLONE_RELEASE".into(),
                    display_path(&self.root.join("release")).into(),
                ),
                ("INKSTREAM_CLONE_MODE".into(), mode.into()),
            ],
        }
    }
    fn run(&self, mode: &str, progress: &mut dyn FnMut(&str)) -> Result<String, CloneFailure> {
        let lease = self.registry.acquire("window-a", ID.into()).unwrap();
        execute(
            self.request(),
            self.runtime(mode),
            lease.control.clone(),
            || panic!("SSH clone must not read GitHub credentials"),
            progress,
        )
    }
    fn clean(&self) {
        assert_eq!(
            std::fs::read(self.root.join("user-file.md")).unwrap(),
            b"preserve neighbor"
        );
        assert!(
            !std::fs::read_dir(&self.root).unwrap().any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".inkstream-clone-")),
            "owned staging was not removed or published"
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.registry.close_owner("window-a");
        self.registry.close_owner("window-b");
        #[cfg(windows)]
        let _ = destination::writable_owned_files(&self.root);
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
fn options(mode: &str, custom: &str) -> RemoteOptions {
    serde_json::from_value(json!({"mode":mode,"customServer":custom})).unwrap()
}
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[test]
fn real_git_clone_returns_the_chosen_complete_workspace_and_original_origin() {
    let fixture = Fixture::new();
    let mut lines = Vec::new();
    let path = fixture
        .run("success", &mut |line| lines.push(line.to_string()))
        .unwrap();
    assert_eq!(
        PathBuf::from(path).canonicalize().unwrap(),
        fixture.target.canonicalize().unwrap()
    );
    assert_eq!(
        std::fs::read(fixture.target.join("README.md")).unwrap(),
        b"# cloned fixture\n"
    );
    let repo = git2::Repository::open(&fixture.target).unwrap();
    assert_eq!(repo.find_remote("origin").unwrap().url().unwrap(), URL);
    assert!(repo.head().is_ok());
    assert!(lines
        .iter()
        .any(|line| line.contains("目标：") && line.contains(URL)));
    fixture.clean();
}

#[test]
fn an_empty_remote_is_still_a_real_openable_clone() {
    let fixture = Fixture::new();
    git2::Repository::init_bare(fixture.root.join("empty.git")).unwrap();
    let lease = fixture.registry.acquire("window-a", ID.into()).unwrap();
    let mut runtime = fixture.runtime("success");
    for (key, value) in &mut runtime.environment {
        if key == "INKSTREAM_CLONE_SOURCE" {
            *value = display_path(&fixture.root.join("empty.git")).into();
        }
    }
    execute(
        fixture.request(),
        runtime,
        lease.control.clone(),
        || panic!("no credentials"),
        &mut |_| {},
    )
    .unwrap();
    let repo = git2::Repository::open(&fixture.target).unwrap();
    assert!(!repo.is_bare());
    assert!(repo.head().is_err());
    assert!(!fixture.target.join("README.md").exists());
    fixture.clean();
}

#[test]
fn an_existing_file_or_directory_is_rejected_before_any_transport_starts() {
    for directory in [false, true] {
        let fixture = Fixture::new();
        if directory {
            std::fs::create_dir(&fixture.target).unwrap();
        } else {
            std::fs::write(&fixture.target, b"original target").unwrap();
        }
        let failure = fixture.run("success", &mut |_| {}).unwrap_err();
        assert_eq!(failure.code, FailureCode::Failed);
        assert!(failure.message.contains("目标目录已存在"));
        assert!(!fixture.root.join("transport-started").exists());
        if directory {
            assert!(fixture.target.is_dir());
        } else {
            assert_eq!(std::fs::read(&fixture.target).unwrap(), b"original target");
        }
        fixture.clean();
    }
}

#[test]
fn a_target_created_while_cloning_is_never_overwritten_even_when_empty() {
    for populated in [false, true] {
        let fixture = Fixture::new();
        let mut created = false;
        let result = fixture.run("gated", &mut |line| {
            if line.contains("fixture-start") && !created {
                std::fs::create_dir(&fixture.target).unwrap();
                if populated {
                    std::fs::write(fixture.target.join("original"), b"user content").unwrap();
                }
                std::fs::write(fixture.root.join("release"), b"ready").unwrap();
                created = true;
            }
        });
        assert!(
            created,
            "fixture did not reach its real transport handshake"
        );
        let failure = result.unwrap_err();
        assert_eq!(failure.code, FailureCode::Failed);
        assert!(fixture.target.is_dir());
        assert!(!fixture.target.join(".git").exists());
        if populated {
            assert_eq!(
                std::fs::read(fixture.target.join("original")).unwrap(),
                b"user content"
            );
        } else {
            assert_eq!(std::fs::read_dir(&fixture.target).unwrap().count(), 0);
        }
        fixture.clean();
    }
}

#[test]
fn real_transport_failure_removes_only_the_owned_staging_and_never_creates_a_project() {
    let fixture = Fixture::new();
    let failure = fixture.run("fail", &mut |_| {}).unwrap_err();
    assert_eq!(failure.code, FailureCode::Failed);
    assert!(failure.message.contains("fixture permission denied"));
    assert!(failure.residual_path.is_none());
    assert!(!fixture.target.exists());
    fixture.clean();
}

#[test]
fn cancellation_stops_the_running_transport_then_removes_the_owned_partial_clone() {
    let fixture = Fixture::new();
    let mut cancelled = false;
    let result = fixture.run("wait", &mut |line| {
        if line.contains("fixture-start") {
            assert!(fixture.registry.cancel("window-a", ID));
            cancelled = true;
        }
    });
    assert!(
        cancelled,
        "fixture was never cancelled while transport was running"
    );
    let failure = result.unwrap_err();
    assert_eq!(failure.code, FailureCode::Cancelled);
    assert!(failure.residual_path.is_none());
    assert!(!fixture.target.exists());
    fixture.clean();
}

#[test]
fn timeout_is_a_failure_with_a_clean_directory_and_not_a_fake_user_cancellation() {
    let fixture = Fixture::new();
    let lease = fixture.registry.acquire("window-a", ID.into()).unwrap();
    let mut runtime = fixture.runtime("wait");
    runtime.timeout = Duration::from_millis(300);
    let start = Instant::now();
    let failure = execute(
        fixture.request(),
        runtime,
        lease.control.clone(),
        || panic!("no credentials"),
        &mut |_| {},
    )
    .unwrap_err();
    assert!(start.elapsed() < Duration::from_secs(5));
    assert_eq!(failure.code, FailureCode::Failed);
    assert!(failure.message.contains("期限"));
    assert!(!fixture.target.exists());
    fixture.clean();
}

#[test]
fn early_cancel_and_window_ownership_cannot_stop_another_windows_task() {
    let fixture = Fixture::new();
    assert!(fixture.registry.cancel("window-a", ID));
    let lease = fixture.registry.acquire("window-a", ID.into()).unwrap();
    let failure = execute(
        fixture.request(),
        fixture.runtime("success"),
        lease.control.clone(),
        || panic!("no credentials"),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(failure.code, FailureCode::Cancelled);
    assert!(!fixture.root.join("transport-started").exists());
    let other = fixture.registry.acquire("window-b", OTHER.into()).unwrap();
    assert!(!fixture.registry.cancel("window-a", OTHER));
    fixture.registry.close_owner("window-a");
    assert!(!other.control.cancelled.load(Ordering::Acquire));
    assert!(fixture.registry.cancel("window-b", OTHER));
    fixture.clean();
}

#[test]
fn clone_admission_is_bounded_and_a_finished_lease_releases_its_slot() {
    let registry = Arc::new(state::Registry::default());
    let mut leases: Vec<_> = (0..4)
        .map(|index| {
            registry
                .acquire(
                    "window-a",
                    format!("{index:08x}-1111-4111-8111-111111111111"),
                )
                .unwrap()
        })
        .collect();
    let fifth = "ffffffff-1111-4111-8111-111111111111";
    assert!(registry.acquire("window-a", fifth.into()).is_err());
    leases.pop();
    assert!(registry.acquire("window-a", fifth.into()).is_ok());
}

#[test]
fn policy_rejects_local_custom_mismatch_and_rewritten_non_github_before_token_lookup() {
    for mode in ["local", "custom", "oauth"] {
        let fixture = Fixture::new();
        let mut request = fixture.request();
        request.options = options(mode, "ssh://other.invalid/repository");
        if mode == "oauth" {
            request.url = "https://github.com/owner/book.git".into();
            std::fs::write(fixture.root.join("config"), "[url \"ssh://fixture.invalid/repository\"]\n    insteadOf = https://github.com/owner/book.git\n").unwrap();
        }
        let read = Cell::new(false);
        let lease = fixture.registry.acquire("window-a", ID.into()).unwrap();
        let failure = execute(
            request,
            fixture.runtime("success"),
            lease.control.clone(),
            || {
                read.set(true);
                Ok(Some("never-send-this-token".into()))
            },
            &mut |_| {},
        )
        .unwrap_err();
        assert_eq!(failure.code, FailureCode::Failed);
        assert!(!read.get(), "policy rejection still read credentials");
        assert!(!fixture.root.join("transport-started").exists());
        assert!(!fixture.target.exists());
        fixture.clean();
    }
}

#[test]
fn github_credentials_are_used_only_after_resolved_admission_and_errors_stay_out_of_progress() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    request.url = "https://github.com/owner/book.git".into();
    request.options = options("oauth", "");
    let lease = fixture.registry.acquire("window-a", ID.into()).unwrap();
    let read = Cell::new(0);
    let failure = execute(
        request,
        fixture.runtime("success"),
        lease.control.clone(),
        || {
            read.set(read.get() + 1);
            Err("GitHub 登录已过期，请重新登录。".into())
        },
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(read.get(), 1);
    assert!(failure.message.contains("重新登录"));
    assert!(!fixture.target.exists());
    fixture.clean();

    let mut destination = Destination::create(&display_path(&fixture.target), ID).unwrap();
    let runtime = fixture.runtime("success");
    let process = spec(
        &runtime,
        &destination,
        "https",
        Some("fixture-secret-token"),
        vec!["clone".into()],
    );
    assert!(process
        .env_remove
        .contains(&OsString::from("INKSTREAM_GH_TOKEN")));
    assert!(process
        .env_set
        .contains(&("INKSTREAM_GH_TOKEN".into(), "fixture-secret-token".into())));
    assert!(!process
        .args
        .iter()
        .any(|argument| argument.to_string_lossy().contains("fixture-secret-token")));
    assert!(process.args.contains(&OsString::from(CRED_HELPER)));
    assert_eq!(
        redacted("failed fixture-secret-token", Some("fixture-secret-token")),
        "failed [redacted]"
    );
    destination.cleanup().unwrap();
}

#[test]
fn uncertain_process_cleanup_retains_staging_and_cannot_report_cancellation_success() {
    let fixture = Fixture::new();
    let mut destination = Destination::create(&display_path(&fixture.target), ID).unwrap();
    std::fs::write(destination.stage.join("partial"), b"partial clone").unwrap();
    destination.before_process();
    let failure = fail(&mut destination, CloneFailure::cancelled());
    assert_eq!(failure.code, FailureCode::Failed);
    assert_eq!(
        failure.residual_path.as_deref(),
        Some(display_path(&destination.stage).as_str())
    );
    assert!(destination.stage.join("partial").exists());
    assert!(!fixture.target.exists());
    // 本例没有启动任何进程；由测试明确释放证明后才能回收自有目录。
    destination.processes_stopped();
    destination.cleanup().unwrap();
    fixture.clean();
}

#[test]
fn destination_guards_reject_relative_parent_escape_and_incomplete_repositories() {
    let fixture = Fixture::new();
    for path in [
        "relative".to_string(),
        display_path(&fixture.root.join("folder/../escape")),
    ] {
        assert!(Destination::create(&path, ID).is_err());
    }
    let mut destination = Destination::create(&display_path(&fixture.target), ID).unwrap();
    std::fs::write(destination.stage.join("README.md"), b"not a repository").unwrap();
    assert!(destination.validate_repository().is_err());
    assert!(!fixture.target.exists());
    destination.cleanup().unwrap();
    fixture.clean();
}
