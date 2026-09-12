//! git 读命令纯函数单测（临时 repo，只测不依赖 tauri 的同步逻辑）。
//!
//! 注：本 crate 链 tauri，gnu 工具链下 `cargo test` 的测试 exe 可能无法启动
//! （STATUS_ENTRYPOINT_NOT_FOUND，见 index.rs 注释）。这些测试做编译期契约校验 + 可在能跑 test 的
//! 环境复核；功能正确性同时经「运行应用 + CDP」端到端验证。

use super::branch::list_branches;
use super::diff::build_diff;
use super::log::walk_log;
use super::status::collect_status;
use super::types::DiffTarget;
use git2::{Oid, Repository, Signature};
use std::path::Path;

/// temp 下建唯一目录（不复用 [[inkstream-test-vault]]，单测要隔离的空 repo）。
fn temp_dir(tag: &str) -> std::path::PathBuf {
    let base = std::env::temp_dir().join(format!(
        "inkstream-git-test-{}-{}-{}",
        tag,
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&base).unwrap();
    base
}

/// 写文件 → stage → 提交，返回 commit oid（首次提交自动作 root，无父）。
fn commit_file(repo: &Repository, name: &str, content: &str, msg: &str) -> Oid {
    let root = repo.workdir().unwrap();
    std::fs::write(root.join(name), content).unwrap();
    let mut index = repo.index().unwrap();
    index.add_path(Path::new(name)).unwrap();
    index.write().unwrap();
    let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
    let sig = Signature::now("Tester", "t@example.com").unwrap();
    let parents: Vec<git2::Commit> = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .and_then(|o| repo.find_commit(o).ok())
        .into_iter()
        .collect();
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs)
        .unwrap()
}

#[test]
fn unborn_repo_has_no_branch_and_empty_log() {
    let dir = temp_dir("unborn");
    let repo = Repository::init(&dir).unwrap();
    assert!(collect_status(&repo).unwrap().branch.is_none()); // 无提交：HEAD 未生分支
    assert!(walk_log(&repo, &[], 0, 10).unwrap().is_empty());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn untracked_file_shows_in_status() {
    let dir = temp_dir("untracked");
    let repo = Repository::init(&dir).unwrap();
    std::fs::write(dir.join("note.md"), "hi").unwrap();
    let status = collect_status(&repo).unwrap();
    let f = status.files.iter().find(|f| f.path == "note.md").unwrap();
    assert_eq!(f.status, "untracked");
    assert!(f.unstaged && !f.staged);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn commit_then_log_and_branch() {
    let dir = temp_dir("commit");
    let repo = Repository::init(&dir).unwrap();
    commit_file(&repo, "a.md", "one", "feat: a");
    commit_file(&repo, "a.md", "two", "fix: a2");
    let log = walk_log(&repo, &[], 0, 10).unwrap();
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].summary, "fix: a2"); // 拓扑+时间序：最新在前
    assert_eq!(log[0].parents.len(), 1);
    let status = collect_status(&repo).unwrap();
    assert!(status.branch.is_some()); // 有提交后 HEAD 落到分支
    assert!(status.files.is_empty()); // 提交后工作区干净
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn log_paging_skip_and_limit() {
    let dir = temp_dir("paging");
    let repo = Repository::init(&dir).unwrap();
    for i in 0..5 {
        commit_file(&repo, "a.md", &format!("v{i}"), &format!("c{i}"));
    }
    assert_eq!(walk_log(&repo, &[], 0, 2).unwrap().len(), 2);
    let page2 = walk_log(&repo, &[], 2, 2).unwrap();
    assert_eq!(page2.len(), 2);
    assert_eq!(page2[0].summary, "c2"); // skip 2 个最新，第三新是 c2
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn branch_list_marks_only_head_at_shared_tip() {
    let dir = temp_dir("branch");
    let repo = Repository::init(&dir).unwrap();
    commit_file(&repo, "a.md", "x", "init");
    // 第二分支指向同一 tip：is_head 须按 HEAD 符号引用判定，不能因同 oid 把两者都标 head。
    let tip = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("feature", &tip, false).unwrap();
    let branches = list_branches(&repo).unwrap();
    let heads: Vec<_> = branches.iter().filter(|b| b.is_head).collect();
    assert_eq!(heads.len(), 1); // 恰一个 HEAD 分支（非两个同 tip 全标）
    assert!(!heads[0].is_remote && heads[0].target.is_some());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn diff_workdir_reports_modified_hunks() {
    let dir = temp_dir("diff");
    let repo = Repository::init(&dir).unwrap();
    commit_file(&repo, "a.md", "one\n", "feat: a");
    std::fs::write(dir.join("a.md"), "one\ntwo\n").unwrap();
    let diffs = build_diff(&repo, DiffTarget::Workdir).unwrap();
    let fd = diffs
        .iter()
        .find(|d| d.new_path.as_deref() == Some("a.md"))
        .unwrap();
    assert_eq!(fd.status, "modified");
    assert!(!fd.binary);
    assert!(fd.hunks.iter().any(|h| h.lines.iter().any(|l| l.origin == '+')));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn generic_abort_restores_a_real_local_rebase() {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    fn git(root: &Path, args: &[&str]) -> std::process::Output {
        let mut command = Command::new("git");
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.current_dir(root)
            .env_remove("GIT_DIR").env_remove("GIT_WORK_TREE").env_remove("GIT_INDEX_FILE")
            .env("GIT_TERMINAL_PROMPT", "0").env("GIT_EDITOR", "true")
            .args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped())
            .spawn().expect("fixture Git must start");
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if child.try_wait().unwrap().is_some() { return child.wait_with_output().unwrap(); }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("fixture Git exceeded its 10 second deadline");
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    let dir = temp_dir("rebase-abort");
    let repo = Repository::init(&dir).unwrap();
    let hooks = dir.join("empty-hooks");
    std::fs::create_dir(&hooks).unwrap();
    {
        let mut config = repo.config().unwrap();
        config.set_bool("core.autocrlf", false).unwrap();
        config.set_bool("commit.gpgsign", false).unwrap();
        config.set_str("core.hooksPath", hooks.to_str().unwrap()).unwrap();
        config.set_str("user.name", "Rebase Fixture").unwrap();
        config.set_str("user.email", "rebase-fixture@example.invalid").unwrap();
    }
    repo.set_head("refs/heads/topic").unwrap();
    let base = commit_file(&repo, "文稿.md", "共同版本\n", "base");
    repo.branch("upstream", &repo.find_commit(base).unwrap(), false).unwrap();
    let original = commit_file(&repo, "文稿.md", "主题稿\n", "topic text");
    repo.set_head("refs/heads/upstream").unwrap();
    repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force())).unwrap();
    commit_file(&repo, "文稿.md", "基线稿\n", "upstream text");
    repo.set_head("refs/heads/topic").unwrap();
    repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force())).unwrap();

    let start = git(&dir, &["rebase", "--merge", "--no-gpg-sign", "--no-autostash", "upstream"]);
    assert!(!start.status.success(), "fixture must stop at a real textual conflict");
    assert!(Repository::open(&dir).unwrap().index().unwrap().has_conflicts());
    let result = tauri::async_runtime::block_on(super::commit::git_abort_op(dir.to_string_lossy().into_owned(), None));
    let after = Repository::open(&dir).unwrap();
    let actual_head = after.head().unwrap().target();
    let actual_body = std::fs::read_to_string(dir.join("文稿.md")).unwrap();
    let active = after.path().join("rebase-merge").exists() || after.path().join("rebase-apply").exists();
    drop(after);
    // Even the intended RED run cleans its own sequencer before removing fixtures.
    if active { assert!(git(&dir, &["rebase", "--abort"]).status.success()); }
    drop(repo);
    std::fs::remove_dir_all(&dir).unwrap();

    assert!(result.is_ok(), "app abort rejected the live rebase: {result:?}");
    assert_eq!(actual_head, Some(original));
    assert_eq!(actual_body, "主题稿\n");
    assert!(!active);
}
