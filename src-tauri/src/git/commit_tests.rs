use super::{commit, Operation};
use crate::git::{rebase_registry, rebase_test_support::{git_path, Fixture}};
use crate::git::rebase_process::test_support::{wait_pid, Sentinel, Watch};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

fn quote(value: &str) -> String { format!("'{}'", value.replace('\'', "'\\''")) }

fn waiting_program(path: &Path, directory: &Path) {
    let executable = std::env::current_exe().unwrap();
    let script = format!("#!/bin/sh\nexport INKSTREAM_PROCESS_FIXTURE_MODE=root\nexport INKSTREAM_PROCESS_FIXTURE_DIRECTORY={}\nexport INKSTREAM_PROCESS_FIXTURE_PARENT={}\nexec {} --ignored --exact git::rebase_process::test_support::fixture_process --nocapture\n",
        quote(&git_path(directory)), std::process::id(), quote(&git_path(&executable)));
    std::fs::write(path, script).unwrap();
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
}

#[test]
fn a_hanging_hook_and_signer_stop_their_trees_preserve_staging_and_allow_signed_retry() {
    for (kind, cancel) in [("hook", true), ("signer", false)] {
        let fixture = Fixture::new(kind);
        let original = fixture.commit("note.md", "original\n", "base");
        fixture.enable_signing();
        let control = fixture.root.join(".git/hang-control");
        std::fs::create_dir(&control).unwrap();
        let mut sentinel = Sentinel::new(&control);
        wait_pid(&control, "sentinel");
        let program = if kind == "hook" { fixture.root.join(".git/fixture-hooks/pre-commit") } else { fixture.root.join(".git/hanging-signer") };
        waiting_program(&program, &control);
        if kind == "signer" { fixture.repo().config().unwrap().set_str("gpg.ssh.program", &git_path(&program)).unwrap(); }
        std::fs::write(fixture.root.join("note.md"), "draft preserved\n").unwrap();
        let id = rebase_registry::request_id();
        let request = id.clone();
        let root = fixture.path();
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || { let _ = send.send(commit(&root, "signed retry", &[], Some(request), Duration::from_secs(4))); });
        let processes: Vec<_> = ["root", "child", "grandchild"].map(|name| Watch::new(wait_pid(&control, name))).into_iter().collect();
        assert!(processes.iter().all(|process| process.alive()));
        if cancel { assert!(rebase_registry::cancel(&fixture.repo(), id).unwrap()); }
        let result = receive.recv_timeout(Duration::from_secs(9)).expect("bounded commit must return");
        let error = result.unwrap_err().to_string();
        assert!(error.contains(if cancel { "取消" } else { "期限" }), "{error}");
        assert!(processes.iter().all(|process| !process.alive()));
        assert!(sentinel.alive());
        assert_eq!(fixture.head(), original);
        assert_eq!(fixture.body("note.md"), "draft preserved\n");
        let repo = fixture.repo();
        let index = repo.index().unwrap();
        let staged = index.get_path(Path::new("note.md"), 0).unwrap();
        assert_eq!(repo.find_blob(staged.id).unwrap().content(), b"draft preserved\n");
        drop(index);
        drop(repo);
        assert!(Operation::begin(&fixture.path(), None, Duration::from_secs(1)).is_ok(), "failed command must release native admission");
        if kind == "hook" { std::fs::remove_file(&program).unwrap(); }
        else { fixture.repo().config().unwrap().set_str("gpg.ssh.program", &git_path(&fixture.signer)).unwrap(); }
        let committed = commit(&fixture.path(), "signed retry", &[], None, Duration::from_secs(15)).unwrap();
        assert!(committed.oid.is_some());
        fixture.verify_signed();
    }
}

#[test]
fn cancelled_before_admission_does_not_stage_or_create_a_commit() {
    let fixture = Fixture::new("early-cancel");
    let original = fixture.commit("note.md", "base\n", "base");
    std::fs::write(fixture.root.join("note.md"), "unstaged\n").unwrap();
    let id = rebase_registry::request_id();
    rebase_registry::cancel(&fixture.repo(), id.clone()).unwrap();
    assert!(commit(&fixture.path(), "must not run", &[], Some(id), Duration::from_secs(2)).unwrap_err().to_string().contains("取消"));
    assert_eq!(fixture.head(), original);
    let repo = fixture.repo();
    let entry = repo.index().unwrap().get_path(Path::new("note.md"), 0).unwrap();
    assert_eq!(repo.find_blob(entry.id).unwrap().content(), b"base\n");
    assert_eq!(fixture.body("note.md"), "unstaged\n");
}
