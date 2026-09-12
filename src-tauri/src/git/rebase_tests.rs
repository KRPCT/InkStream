use super::rebase::{execute, RebaseAction, RebaseOutcome};
use super::rebase_registry;
use super::rebase_test_support::{git_path, Fixture};
use super::rebase_types::RebaseSource;

#[test]
fn signed_rebase_preserves_patches_and_other_refs() {
    let fixture = Fixture::new("signed");
    let original = fixture.divergent(false, false);
    fixture.enable_signing();
    {
        let repo = fixture.repo();
        repo.branch("untouched", &repo.find_commit(original).unwrap(), false).unwrap();
        repo.config().unwrap().set_bool("rebase.updateRefs", true).unwrap();
    }
    let result = fixture.action(RebaseAction::Start { upstream: "upstream".into() });
    assert_eq!(result.outcome, RebaseOutcome::Completed, "{result:?}");
    assert!(!result.status.in_progress);
    assert_eq!(fixture.body("note.md"), "主题稿\n");
    assert_eq!(fixture.body("upstream.md"), "基线新增\n");
    let repo = fixture.repo();
    assert_eq!(repo.find_reference("refs/heads/untouched").unwrap().target(), Some(original));
    assert!(repo.graph_descendant_of(fixture.head(), repo.find_reference("refs/heads/upstream").unwrap().target().unwrap()).unwrap());
    fixture.verify_signed();
}

#[test]
fn conflict_continue_and_skip_keep_application_signing() {
    for skip in [false, true] {
        let fixture = Fixture::new(if skip { "skip" } else { "continue" });
        let original = fixture.divergent(true, skip);
        fixture.enable_signing();
        let paused = fixture.action(RebaseAction::Start { upstream: "upstream".into() });
        assert_eq!(paused.outcome, RebaseOutcome::Paused, "{paused:?}");
        assert_eq!(paused.status.source, Some(RebaseSource::Application));
        assert_eq!(paused.status.original_head, Some(original.to_string()));
        assert_eq!(paused.status.conflicts, vec!["note.md"]);
        assert!(fixture.repo().index().unwrap().has_conflicts());
        let result = if skip { fixture.action(RebaseAction::Skip) }
            else { fixture.resolve("人工合并结果\n"); fixture.action(RebaseAction::Continue) };
        assert_eq!(result.outcome, RebaseOutcome::Completed, "{result:?}");
        assert_eq!(fixture.body("note.md"), if skip { "基线稿\n" } else { "人工合并结果\n" });
        if skip { assert_eq!(fixture.body("later.md"), "后续独立内容\n"); }
        fixture.verify_signed();
    }
}

#[test]
fn external_unsigned_sequence_keeps_its_original_policy_when_continued() {
    let fixture = Fixture::new("external");
    fixture.divergent(true, false);
    fixture.enable_signing();
    assert_ne!(fixture.git(&["rebase", "--merge", "--no-gpg-sign", "upstream"]).exit_code, Some(0));
    fixture.repo().config().unwrap().set_bool("commit.gpgsign", true).unwrap();
    let status = super::rebase_state::inspect(&fixture.repo()).unwrap();
    assert_eq!(status.source, Some(RebaseSource::Existing));
    fixture.resolve("外部序列的解决结果\n");
    let result = fixture.action(RebaseAction::Continue);
    assert_eq!(result.outcome, RebaseOutcome::Completed, "{result:?}");
    assert!(fixture.repo().extract_signature(&fixture.head(), None).is_err());
}

#[test]
fn signing_failure_retains_state_for_a_later_continue() {
    let fixture = Fixture::new("sign-recovery");
    let original = fixture.divergent(false, false);
    fixture.enable_signing();
    fixture.repo().config().unwrap().set_str("gpg.ssh.program", "inkstream-missing-fixture-signer").unwrap();
    let failed = fixture.action(RebaseAction::Start { upstream: "upstream".into() });
    assert_eq!(failed.outcome, RebaseOutcome::Failed, "{failed:?}");
    assert!(failed.status.in_progress);
    assert!(failed.status.conflicts.is_empty());
    assert!(failed.status.needs_commit, "{failed:?}; git status={:?}; cached={:?}; cherry_pick={:?}", fixture.git(&["status", "--porcelain=v1"]), fixture.git(&["diff", "--cached", "--stat"]), fixture.repo().revparse_single("CHERRY_PICK_HEAD").map(|object| object.id()));
    fixture.repo().config().unwrap().set_str("gpg.ssh.program", &git_path(&fixture.signer)).unwrap();
    let resumed = fixture.action(RebaseAction::CommitContinue { commit: failed.status.current_commit.unwrap() });
    assert_eq!(resumed.outcome, RebaseOutcome::Completed, "{resumed:?}");
    fixture.verify_signed();
    let repo = fixture.repo();
    let mut walk = repo.revwalk().unwrap(); walk.push_head().unwrap();
    assert_eq!(walk.count(), 3);
    let before = repo.find_commit(original).unwrap();
    let after = repo.find_commit(fixture.head()).unwrap();
    assert_eq!(after.message_bytes(), before.message_bytes());
    assert_eq!(after.author().name_bytes(), before.author().name_bytes());
    assert_eq!(after.author().email_bytes(), before.author().email_bytes());
    assert_eq!(after.author().when().seconds(), before.author().when().seconds());
    assert_eq!(after.author().when().offset_minutes(), before.author().when().offset_minutes());
}

#[test]
fn stale_resolution_does_not_write_or_stage_a_newer_file() {
    let fixture = Fixture::new("stale-resolution");
    fixture.divergent(true, false);
    fixture.git(&["rebase", "--merge", "--no-gpg-sign", "upstream"]);
    let expected = fixture.body("note.md");
    std::fs::write(fixture.root.join("note.md"), "另一份较新的编辑\n").unwrap();
    let result = tauri::async_runtime::block_on(super::conflict::git_resolve_conflict(fixture.path(), "note.md".into(), "旧的面板选择\n".into(), Some(expected)));
    assert!(result.is_err());
    assert_eq!(fixture.body("note.md"), "另一份较新的编辑\n");
    assert!(fixture.repo().index().unwrap().has_conflicts());
}

#[test]
fn existing_rebase_blocks_other_worktree_writers_and_cancel_cannot_reactivate() {
    let fixture = Fixture::new("admission");
    let original = fixture.divergent(true, false);
    let request = rebase_registry::request_id();
    assert!(rebase_registry::cancel(&fixture.repo(), request.clone()).unwrap());
    let cancelled = execute(&fixture.path(), request, RebaseAction::Start { upstream: "upstream".into() }).unwrap();
    assert_eq!(cancelled.outcome, RebaseOutcome::Cancelled);
    assert_eq!(fixture.head(), original);
    fixture.git(&["rebase", "--merge", "--no-gpg-sign", "upstream"]);
    let before = fixture.body("note.md");
    let checkout = tauri::async_runtime::block_on(super::refops::git_checkout(fixture.path(), "upstream".into(), true));
    assert!(checkout.is_err());
    assert_eq!(fixture.body("note.md"), before);
    let aborted = fixture.action(RebaseAction::Abort);
    assert_eq!(aborted.outcome, RebaseOutcome::Aborted, "{aborted:?}");
    assert_eq!(fixture.head(), original);
    assert_eq!(fixture.body("note.md"), "主题稿\n");
}

#[test]
fn invalid_target_and_dirty_start_preserve_head_and_file_contents() {
    let fixture = Fixture::new("invalid");
    let original = fixture.divergent(false, false);
    let invalid = fixture.action(RebaseAction::Start { upstream: "--exec=unexpected".into() });
    assert_eq!(invalid.outcome, RebaseOutcome::Failed);
    std::fs::write(fixture.root.join("note.md"), "未提交的稿件\n").unwrap();
    let dirty = fixture.action(RebaseAction::Start { upstream: "upstream".into() });
    assert_eq!(dirty.outcome, RebaseOutcome::Failed);
    assert!(!dirty.status.in_progress);
    assert_eq!(fixture.head(), original);
    assert_eq!(fixture.body("note.md"), "未提交的稿件\n");
}
