use super::{git_stash_drop, git_stash_list, git_stash_pop, git_stash_save, StashEntry};
use crate::git::rebase_test_support::Fixture;

fn run<T>(future: impl std::future::Future<Output = T>) -> T { tauri::async_runtime::block_on(future) }
fn entries(fixture: &Fixture) -> Vec<StashEntry> { run(git_stash_list(fixture.path())).unwrap() }
fn save(fixture: &Fixture, content: &str, message: &str) -> String {
    std::fs::write(fixture.root.join("note.md"), content).unwrap();
    run(git_stash_save(fixture.path(), message.into())).unwrap();
    entries(fixture)[0].oid.clone()
}

#[test]
fn selected_stash_is_restored_and_only_the_requested_other_record_is_deleted() {
    let fixture = Fixture::new("stash-selected");
    fixture.commit("note.md", "base\n", "base");
    let first = save(&fixture, "first draft\n", "first");
    let second = save(&fixture, "second draft\n", "second");
    assert_eq!(entries(&fixture).iter().map(|entry| entry.oid.as_str()).collect::<Vec<_>>(), vec![second.as_str(), first.as_str()]);
    run(git_stash_pop(fixture.path(), 1, Some(first))).unwrap();
    assert_eq!(fixture.body("note.md"), "first draft\n");
    assert_eq!(entries(&fixture).len(), 1);
    assert_eq!(entries(&fixture)[0].oid, second);
    run(git_stash_drop(fixture.path(), 0, Some(second))).unwrap();
    assert!(entries(&fixture).is_empty());
    assert_eq!(fixture.body("note.md"), "first draft\n");
}

#[test]
fn a_reordered_index_cannot_restore_or_delete_a_different_stash() {
    let fixture = Fixture::new("stash-stale");
    fixture.commit("note.md", "base\n", "base");
    let selected = save(&fixture, "selected draft\n", "selected");
    let newer = save(&fixture, "newer draft\n", "newer");
    assert!(run(git_stash_pop(fixture.path(), 0, Some(selected.clone()))).is_err());
    assert!(run(git_stash_drop(fixture.path(), 0, Some(selected.clone()))).is_err());
    assert_eq!(fixture.body("note.md"), "base\n");
    assert_eq!(entries(&fixture).iter().map(|entry| entry.oid.as_str()).collect::<Vec<_>>(), vec![newer.as_str(), selected.as_str()]);
}

#[test]
fn a_restore_conflict_keeps_the_stash_and_the_current_branch_content() {
    let fixture = Fixture::new("stash-conflict");
    fixture.commit("note.md", "base\n", "base");
    let selected = save(&fixture, "stash side\n", "saved");
    fixture.commit("note.md", "branch side\n", "branch edit");
    {
        let repo = fixture.repo();
        let stash = repo.find_commit(git2::Oid::from_str(&selected).unwrap()).unwrap();
        let note = std::path::Path::new("note.md");
        let original = stash.parent(0).unwrap().tree().unwrap().get_path(note).unwrap().id();
        let stashed = stash.tree().unwrap().get_path(note).unwrap().id();
        let current = repo.head().unwrap().peel_to_tree().unwrap().get_path(note).unwrap().id();
        assert_eq!(repo.find_blob(original).unwrap().content(), b"base\n");
        assert_eq!(repo.find_blob(stashed).unwrap().content(), b"stash side\n");
        assert_eq!(repo.find_blob(current).unwrap().content(), b"branch side\n");
    }
    let restored = run(git_stash_pop(fixture.path(), 0, Some(selected.clone())));
    let conflicts = fixture.repo().index().unwrap().has_conflicts();
    let body = fixture.body("note.md");
    assert!(restored.is_err(), "{restored:?}; index_conflicts={conflicts}; body={body:?}");
    assert!(conflicts, "{restored:?}; body={body:?}");
    assert_eq!(entries(&fixture)[0].oid, selected);
    assert!(body.contains("branch side") && body.contains("stash side") && body.contains("<<<<<<<"));
}
