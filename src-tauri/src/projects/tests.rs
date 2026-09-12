use super::{io, types::{Document, Layout}, ProjectRepository, Snapshot};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const PROJECT: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";
const KEY: &str = "33333333-3333-4333-8333-333333333333";
const TOKEN1: &str = "44444444-4444-4444-8444-444444444444";
const TOKEN2: &str = "55555555-5555-4555-8555-555555555555";
const TOKEN3: &str = "66666666-6666-4666-8666-666666666666";

struct Fixture { root: PathBuf, source: PathBuf, store: ProjectRepository }
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("inkstream-project-{}", io::nonce()));
        fs::create_dir(&root).unwrap(); let root = root.canonicalize().unwrap();
        let source = root.join("中文项目"); fs::create_dir(&source).unwrap();
        fs::write(source.join("user.md"), "用户原文\n").unwrap();
        let store = ProjectRepository::new(root.join("app-data"));
        Self { root, source, store }
    }
    fn register(&self) { self.store.register(PROJECT.into(), io::display(&self.source).unwrap(), "书稿".into()).unwrap(); }
    fn checkpoint(&self, project: Option<&str>, token: &str, revision: u64, body: &str) -> super::StoredSession {
        let id = project.map(str::to_owned);
        let ticket = self.store.session_begin(id.clone(), token.into(), revision, vec![KEY.into()], "main".into()).unwrap();
        crate::files::write_atomic(&Path::new(&ticket.root).join(&ticket.entries[0].path), body).unwrap();
        let snapshot = snapshot(revision, ticket.entries[0].content_file.clone(), project.is_none());
        self.store.session_commit(id, token.into(), snapshot, "main").unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.store.close_owner("main"); self.store.close_owner("other");
        let _ = fs::remove_dir_all(&self.root);
    }
}
fn snapshot(revision: u64, content_file: String, draft: bool) -> Snapshot {
    let layout = Layout { sidebar_width: 280.0, right_panel_width: 320.0, sidebar_collapsed: false, right_panel_collapsed: false };
    let path = if draft { "draft://1" } else { "user.md" }.to_string();
    Snapshot { version: 1, revision,
        documents: vec![Document { key: KEY.into(), path: path.clone(), name: "文稿".into(), external: false, draft, dirty: draft,
            content_file, anchor: 0, head: 0, scroll_top: 0.0, render_mode: Some("live".into()) }],
        active_path: Some(path), mode: "standard".into(), layouts: ["standard", "academic", "creative"].into_iter().map(|mode| (mode.into(), layout.clone())).collect::<BTreeMap<_, _>>(), active_tool: "outline".into() }
}

#[test]
fn catalog_identity_favorites_relocation_and_soft_removal_do_not_modify_content() {
    let f = Fixture::new(); f.register();
    f.store.update(PROJECT.into(), Some("自定义书名".into()), Some(true)).unwrap();
    let duplicate = f.store.register(OTHER.into(), io::display(&f.source.join(".")).unwrap(), "文件夹默认名".into()).unwrap();
    assert_eq!(duplicate.id, PROJECT); assert_eq!(duplicate.name, "自定义书名"); assert!(duplicate.favorite);
    f.store.activate(Some(PROJECT.into())).unwrap();
    assert!(f.store.remove(PROJECT.into()).is_err());
    f.store.activate(None).unwrap(); f.store.remove(PROJECT.into()).unwrap();
    assert!(f.store.catalog_get().unwrap().projects[0].removed);
    let restored = f.store.register(OTHER.into(), io::display(&f.source).unwrap(), "新名称".into()).unwrap();
    assert_eq!(restored.id, PROJECT); assert!(!restored.removed); assert!(restored.favorite);
    let destination = f.root.join("新位置"); fs::create_dir(&destination).unwrap();
    let relocated = f.store.relocate(PROJECT.into(), io::display(&destination).unwrap()).unwrap();
    assert_eq!(relocated.id, PROJECT); assert_eq!(relocated.name, "自定义书名");
    assert_eq!(fs::read_to_string(f.source.join("user.md")).unwrap(), "用户原文\n");
    assert_eq!(fs::read_dir(&f.source).unwrap().count(), 1);
    assert_eq!(fs::read_dir(&destination).unwrap().count(), 0);
    let index = f.store.index_directory(&io::display(&destination).unwrap()).unwrap();
    assert!(index.starts_with(f.root.join("app-data/indexes"))); assert!(index.ends_with(PROJECT));
}

#[cfg(windows)]
#[test]
fn windows_directory_identity_is_case_insensitive() {
    let f = Fixture::new(); f.register();
    let duplicate = f.store.register(OTHER.into(), io::display(&f.source).unwrap().to_uppercase(), "dup".into()).unwrap();
    assert_eq!(duplicate.id, PROJECT);
}

#[test]
fn relocation_cannot_take_another_registered_directory_and_cover_is_an_owned_copy() {
    let f = Fixture::new(); f.register();
    let other = f.root.join("other"); fs::create_dir(&other).unwrap();
    f.store.register(OTHER.into(), io::display(&other).unwrap(), "other".into()).unwrap();
    assert!(f.store.relocate(PROJECT.into(), io::display(&other).unwrap()).is_err());
    let cover = f.root.join("cover.png"); let png = b"\x89PNG\r\n\x1a\nfixture image bytes";
    fs::write(&cover, png).unwrap();
    let record = f.store.import_cover(PROJECT.into(), io::display(&cover).unwrap()).unwrap();
    fs::remove_file(&cover).unwrap();
    let managed = PathBuf::from(record.cover.unwrap());
    assert!(managed.starts_with(f.root.join("app-data/projects/covers").join(PROJECT)));
    assert_eq!(fs::read(managed).unwrap(), png);
    fs::write(&cover, b"not PNG").unwrap(); assert!(f.store.import_cover(PROJECT.into(), io::display(&cover).unwrap()).is_err());
    let large = fs::File::create(f.root.join("large.jpg")).unwrap(); large.set_len(8 * 1024 * 1024 + 1).unwrap(); drop(large);
    assert!(f.store.import_cover(PROJECT.into(), io::display(&f.root.join("large.jpg")).unwrap()).is_err());
}

#[test]
fn unknown_and_corrupt_catalogs_are_not_replaced_by_empty_defaults_and_backup_restore_preserves_them() {
    let f = Fixture::new(); f.register();
    let catalog = f.root.join("app-data/projects/catalog.json");
    for bad in [b"{broken".as_slice(), b"{\"version\":7,\"activeId\":null,\"projects\":[]}".as_slice()] {
        fs::write(&catalog, bad).unwrap();
        assert!(f.store.catalog_get().is_err());
        assert!(f.store.update(PROJECT.into(), Some("must not save".into()), None).is_err());
        assert_eq!(fs::read(&catalog).unwrap(), bad);
        f.store.restore_backup(None, "catalog").unwrap();
        assert_eq!(f.store.catalog_get().unwrap().projects[0].id, PROJECT);
        assert!(fs::read_dir(catalog.parent().unwrap()).unwrap().flatten().any(|entry| entry.file_name().to_string_lossy().starts_with("catalog.json.preserved-") && fs::read(entry.path()).unwrap() == bad));
    }
}

#[test]
fn null_project_drafts_survive_restart_as_immutable_versions_with_a_previous_backup() {
    let f = Fixture::new();
    let first = f.checkpoint(None, TOKEN1, 0, "原稿🙂\n");
    let original = first.snapshot.unwrap();
    assert_eq!(original.revision, 1);
    let old_file = Path::new(&first.root).join(&original.documents[0].content_file);
    let second = f.checkpoint(None, TOKEN2, 1, "第二稿🙂\n");
    assert_eq!(fs::read_to_string(&old_file).unwrap(), "原稿🙂\n");
    let restarted = ProjectRepository::new(f.root.join("app-data"));
    let current = restarted.session_read(None).unwrap().snapshot.unwrap();
    assert_eq!(current.revision, 2);
    assert_eq!(fs::read_to_string(Path::new(&second.root).join(&current.documents[0].content_file)).unwrap(), "第二稿🙂\n");
    let backup: Snapshot = serde_json::from_slice(&fs::read(Path::new(&second.root).join("session.backup.json")).unwrap()).unwrap();
    assert_eq!(backup, original);
}

#[test]
fn snapshot_revision_owner_and_content_scope_are_compared_before_publish() {
    let f = Fixture::new(); f.register();
    let first = f.checkpoint(Some(PROJECT), TOKEN1, 0, "first");
    let previous = first.snapshot.unwrap();
    assert!(f.store.session_begin(Some(PROJECT.into()), TOKEN2.into(), 0, vec![], "main".into()).is_err());
    let ticket = f.store.session_begin(Some(PROJECT.into()), TOKEN2.into(), 1, vec![KEY.into()], "main".into()).unwrap();
    assert!(f.store.session_begin(Some(PROJECT.into()), TOKEN3.into(), 1, vec![], "other".into()).is_err());
    let next = snapshot(1, ticket.entries[0].content_file.clone(), false);
    assert!(f.store.session_commit(Some(PROJECT.into()), TOKEN2.into(), next.clone(), "other").is_err());
    assert!(f.store.session_abort(Some(PROJECT.into()), TOKEN2.into(), "other").is_err());
    assert!(f.store.session_commit(Some(PROJECT.into()), TOKEN2.into(), next, "main").is_err(), "an unwritten body cannot be published");
    assert_eq!(f.store.session_read(Some(PROJECT.into())).unwrap().snapshot.unwrap(), previous);
    let ticket = f.store.session_begin(Some(PROJECT.into()), TOKEN3.into(), 1, vec![], "main".into()).unwrap();
    let foreign = snapshot(1, format!("versions/{TOKEN2}/{KEY}.txt"), false);
    assert!(f.store.session_commit(Some(PROJECT.into()), ticket.token, foreign, "main").is_err());
    assert_eq!(f.store.session_read(Some(PROJECT.into())).unwrap().snapshot.unwrap(), previous);
}

#[test]
fn abort_and_expiry_remove_only_registered_stage_files_and_keep_unknown_files() {
    let f = Fixture::new();
    let ticket = f.store.session_begin(None, TOKEN1.into(), 0, vec![KEY.into()], "main".into()).unwrap();
    crate::files::write_atomic(&Path::new(&ticket.root).join(&ticket.entries[0].path), "owned").unwrap();
    fs::write(Path::new(&ticket.root).join("unknown.txt"), "preserve").unwrap();
    f.store.session_abort(None, TOKEN1.into(), "main").unwrap();
    assert!(!Path::new(&ticket.root).join(&ticket.entries[0].path).exists());
    assert_eq!(fs::read_to_string(Path::new(&ticket.root).join("unknown.txt")).unwrap(), "preserve");
    let second = f.store.session_begin(None, TOKEN2.into(), 0, vec![KEY.into()], "main".into()).unwrap();
    crate::files::write_atomic(&Path::new(&second.root).join(&second.entries[0].path), "expired").unwrap();
    f.store.state.lock().unwrap().leases.get_mut("scratch").unwrap().started = Instant::now() - Duration::from_secs(121);
    let third = f.store.session_begin(None, TOKEN3.into(), 0, vec![], "main".into()).unwrap();
    assert!(!Path::new(&second.root).exists());
    f.store.close_owner("main"); assert!(!Path::new(&third.root).exists());
    assert!(Path::new(&ticket.root).join("unknown.txt").exists());
}

use std::time::{Duration, Instant};

#[test]
fn invalid_utf8_selections_and_duplicate_documents_do_not_replace_the_current_session() {
    let f = Fixture::new(); let first = f.checkpoint(None, TOKEN1, 0, "valid");
    for (token, bytes, bad_selection) in [(TOKEN2, vec![0xff], false), (TOKEN3, b"tiny".to_vec(), true)] {
        let ticket = f.store.session_begin(None, token.into(), 1, vec![KEY.into()], "main".into()).unwrap();
        fs::write(Path::new(&ticket.root).join(&ticket.entries[0].path), bytes).unwrap();
        let mut value = snapshot(1, ticket.entries[0].content_file.clone(), true);
        if bad_selection { value.documents[0].head = 999; }
        assert!(f.store.session_commit(None, token.into(), value, "main").is_err());
        assert_eq!(f.store.session_read(None).unwrap().snapshot, first.snapshot);
    }
    let ticket = f.store.session_begin(None, TOKEN2.into(), 1, vec![], "main".into()).unwrap();
    let mut duplicate = first.snapshot.clone().unwrap(); duplicate.documents.push(duplicate.documents[0].clone());
    assert!(f.store.session_commit(None, ticket.token, duplicate, "main").is_err());
    assert_eq!(f.store.session_read(None).unwrap().snapshot, first.snapshot);
}

#[test]
fn collapsed_and_small_window_geometry_does_not_block_a_valid_checkpoint() {
    let f = Fixture::new();
    let ticket = f.store.session_begin(None, TOKEN1.into(), 0, vec![KEY.into()], "main".into()).unwrap();
    crate::files::write_atomic(&Path::new(&ticket.root).join(&ticket.entries[0].path), "draft").unwrap();
    let mut value = snapshot(0, ticket.entries[0].content_file.clone(), true);
    value.layouts.get_mut("standard").unwrap().sidebar_width = 0.0;
    value.layouts.get_mut("standard").unwrap().right_panel_width = 4096.0;
    let saved = f.store.session_commit(None, TOKEN1.into(), value, "main").unwrap();
    assert_eq!(saved.snapshot.as_ref().unwrap().layouts["standard"].sidebar_width, 0.0);
    let ticket = f.store.session_begin(None, TOKEN2.into(), 1, vec![], "main".into()).unwrap();
    let mut invalid = saved.snapshot.clone().unwrap(); invalid.layouts.get_mut("standard").unwrap().sidebar_width = f64::INFINITY;
    assert!(f.store.session_commit(None, ticket.token, invalid, "main").is_err());
    assert_eq!(f.store.session_read(None).unwrap().snapshot, saved.snapshot);
}

#[test]
fn collection_keeps_current_and_backup_bodies_and_never_removes_unknown_version_contents() {
    let f = Fixture::new(); let first = f.checkpoint(None, TOKEN1, 0, "one");
    let first_file = Path::new(&first.root).join(&first.snapshot.unwrap().documents[0].content_file);
    let unknown = first_file.parent().unwrap().join("unknown.txt"); fs::write(&unknown, "preserve").unwrap();
    let second = f.checkpoint(None, TOKEN2, 1, "two");
    let second_file = Path::new(&second.root).join(&second.snapshot.unwrap().documents[0].content_file);
    let third = f.checkpoint(None, TOKEN3, 2, "three");
    let third_file = Path::new(&third.root).join(&third.snapshot.unwrap().documents[0].content_file);
    assert!(!first_file.exists()); assert!(second_file.exists()); assert!(third_file.exists());
    assert_eq!(fs::read_to_string(unknown).unwrap(), "preserve");
}

#[test]
fn restored_original_manifest_keeps_its_shared_body_after_later_checkpoint_collection() {
    let f = Fixture::new(); let first = f.checkpoint(None, TOKEN1, 0, "original recoverable body");
    let original_file = Path::new(&first.root).join(&first.snapshot.as_ref().unwrap().documents[0].content_file);
    // Revision two reuses revision one's immutable body. Restoring revision one
    // preserves revision two, which still needs that same body after future edits.
    let ticket = f.store.session_begin(None, TOKEN2.into(), 1, vec![], "main".into()).unwrap();
    f.store.session_commit(None, ticket.token, first.snapshot.clone().unwrap(), "main").unwrap();
    f.store.restore_backup(None, "session").unwrap();
    f.checkpoint(None, TOKEN2, 1, "later body");
    f.checkpoint(None, TOKEN3, 2, "newest body");
    assert_eq!(fs::read_to_string(&original_file).unwrap(), "original recoverable body");
    let preserved = fs::read_dir(&first.root).unwrap().flatten().find(|entry| entry.file_name().to_string_lossy().starts_with("session.json.preserved-")).unwrap();
    let recovered: Snapshot = serde_json::from_slice(&fs::read(preserved.path()).unwrap()).unwrap();
    assert_eq!(recovered.revision, 2);
    assert_eq!(fs::read_to_string(Path::new(&first.root).join(&recovered.documents[0].content_file)).unwrap(), "original recoverable body");
}

#[test]
fn an_unreadable_preserved_manifest_stops_gc_without_blocking_new_checkpoints() {
    let f = Fixture::new(); let first = f.checkpoint(None, TOKEN1, 0, "retain while original cannot be decoded");
    let original_file = Path::new(&first.root).join(&first.snapshot.as_ref().unwrap().documents[0].content_file);
    fs::write(Path::new(&first.root).join("session.json"), b"{corrupt original").unwrap();
    f.store.restore_backup(None, "session").unwrap();
    f.checkpoint(None, TOKEN2, 1, "later body"); f.checkpoint(None, TOKEN3, 2, "newest body");
    assert!(original_file.is_file());
    assert_eq!(f.store.session_read(None).unwrap().snapshot.unwrap().revision, 3);
}

#[test]
fn cursor_only_checkpoints_and_reads_reuse_verified_body_lengths_without_rescanning() {
    let f = Fixture::new();
    let first = f.checkpoint(None, TOKEN1, 0, &"unchanged 🙂\n".repeat(100_000));
    f.store.session_read(None).unwrap(); // Warm the published path if its rename changed metadata.
    let before = f.store.body_cache.lock().unwrap().statistics();
    let ticket = f.store.session_begin(None, TOKEN2.into(), 1, vec![], "main".into()).unwrap();
    let mut moved = first.snapshot.unwrap(); moved.documents[0].anchor = 1; moved.documents[0].head = 7;
    f.store.session_commit(None, ticket.token, moved, "main").unwrap();
    f.store.session_read(None).unwrap();
    let after = f.store.body_cache.lock().unwrap().statistics();
    assert_eq!(after.0, before.0, "cursor metadata and backup validation must not reread the unchanged body");
    assert!(after.1 > before.1);
}

#[test]
fn replacement_with_equal_size_and_modified_time_still_invalidates_the_body_identity_cache() {
    let f = Fixture::new(); let first = f.checkpoint(None, TOKEN1, 0, "ABCD");
    f.store.session_read(None).unwrap();
    let document = &first.snapshot.as_ref().unwrap().documents[0];
    let path = Path::new(&first.root).join(&document.content_file);
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    crate::files::write_atomic(&path, "🙂").unwrap(); // Four UTF-8 bytes, but only two UTF-16 units.
    fs::OpenOptions::new().write(true).open(&path).unwrap().set_times(fs::FileTimes::new().set_modified(modified)).unwrap();
    let ticket = f.store.session_begin(None, TOKEN2.into(), 1, vec![], "main".into()).unwrap();
    let mut invalid_selection = first.snapshot.unwrap(); invalid_selection.documents[0].head = 4;
    assert!(f.store.session_commit(None, ticket.token, invalid_selection, "main").unwrap_err().contains("选区"));
    assert_eq!(f.store.body_length(&path, None, false).unwrap(), 2);
}

#[test]
fn changed_body_bytes_are_revalidated_and_fresh_ticket_bodies_never_take_a_cache_shortcut() {
    let f = Fixture::new(); let first = f.checkpoint(None, TOKEN1, 0, "ABCD");
    f.store.session_read(None).unwrap();
    let path = Path::new(&first.root).join(&first.snapshot.as_ref().unwrap().documents[0].content_file);
    fs::write(&path, [0xff; 4]).unwrap();
    assert!(f.store.session_read(None).unwrap_err().contains("UTF-8"));
    crate::files::write_atomic(&path, "ABCD").unwrap();
    f.store.session_read(None).unwrap();
    let ticket = f.store.session_begin(None, TOKEN2.into(), 1, vec![KEY.into()], "main".into()).unwrap();
    let stage = Path::new(&ticket.root).join(&ticket.entries[0].path);
    crate::files::write_atomic(&stage, "new body").unwrap();
    f.store.body_length(&stage, None, false).unwrap();
    let before = f.store.body_cache.lock().unwrap().statistics().0;
    f.store.session_commit(None, ticket.token, snapshot(1, ticket.entries[0].content_file.clone(), true), "main").unwrap();
    assert_eq!(f.store.body_cache.lock().unwrap().statistics().0, before + 1, "new ticket content must receive a fresh full validation even when its metadata was cached");
}

#[test]
fn body_cache_is_bounded_and_expired_deadlines_fail_even_when_the_body_is_cached() {
    let f = Fixture::new(); let directory = f.root.join("cache-fixture"); fs::create_dir(&directory).unwrap();
    for index in 0..520 {
        let path = directory.join(format!("{index}.txt")); fs::write(&path, b"body").unwrap();
        f.store.body_length(&path, None, false).unwrap();
    }
    let stats = f.store.body_cache.lock().unwrap().statistics();
    assert!(stats.2 <= 512 && stats.3 <= 1024 * 1024);
    let path = directory.join("519.txt");
    assert!(f.store.body_length(&path, Some(Instant::now() - Duration::from_millis(1)), false).unwrap_err().contains("期限"));
}

#[test]
fn failed_manifest_write_preserves_the_valid_session_and_unknown_destination_directory() {
    let f = Fixture::new(); let first = f.checkpoint(None, TOKEN1, 0, "first");
    let root = PathBuf::from(&first.root);
    fs::remove_file(root.join("session.backup.json")).unwrap();
    fs::create_dir(root.join("session.backup.json")).unwrap();
    fs::write(root.join("session.backup.json/unknown.txt"), "preserve").unwrap();
    let ticket = f.store.session_begin(None, TOKEN2.into(), 1, vec![KEY.into()], "main".into()).unwrap();
    crate::files::write_atomic(&Path::new(&ticket.root).join(&ticket.entries[0].path), "next").unwrap();
    assert!(f.store.session_commit(None, TOKEN2.into(), snapshot(1, ticket.entries[0].content_file.clone(), true), "main").is_err());
    assert_eq!(f.store.session_read(None).unwrap().snapshot, first.snapshot);
    assert_eq!(fs::read_to_string(root.join("session.backup.json/unknown.txt")).unwrap(), "preserve");
}

#[cfg(windows)]
#[test]
fn a_locked_manifest_cannot_publish_a_new_session_or_damage_the_previous_backup() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new(); let first = f.checkpoint(None, TOKEN1, 0, "first");
    let root = PathBuf::from(&first.root);
    let ticket = f.store.session_begin(None, TOKEN2.into(), 1, vec![KEY.into()], "main".into()).unwrap();
    crate::files::write_atomic(&Path::new(&ticket.root).join(&ticket.entries[0].path), "next").unwrap();
    let held = fs::OpenOptions::new().read(true).share_mode(1).open(root.join("session.json")).unwrap();
    assert!(f.store.session_commit(None, TOKEN2.into(), snapshot(1, ticket.entries[0].content_file.clone(), true), "main").is_err());
    drop(held);
    assert_eq!(f.store.session_read(None).unwrap().snapshot, first.snapshot);
    assert!(!root.join("versions").join(TOKEN2).exists());
}

#[test]
fn oversized_or_unknown_session_metadata_is_preserved_and_explicit_backup_recovery_validates_bodies() {
    let f = Fixture::new(); let first = f.checkpoint(None, TOKEN1, 0, "draft\n");
    let root = PathBuf::from(&first.root);
    let path = root.join("session.json");
    let bad = vec![b'x'; io::JSON_LIMIT + 1]; fs::write(&path, &bad).unwrap();
    assert!(f.store.session_read(None).is_err());
    f.store.restore_backup(None, "session").unwrap();
    assert_eq!(f.store.session_read(None).unwrap().snapshot, first.snapshot);
    assert!(fs::read_dir(&root).unwrap().flatten().any(|entry| entry.file_name().to_string_lossy().starts_with("session.json.preserved-") && fs::read(entry.path()).unwrap() == bad));
    fs::remove_file(root.join(&first.snapshot.unwrap().documents[0].content_file)).unwrap();
    fs::write(&path, b"{damaged").unwrap();
    assert!(f.store.restore_backup(None, "session").is_err());
    assert_eq!(fs::read(path).unwrap(), b"{damaged");
}

#[cfg(unix)]
#[test]
fn version_symlinks_cannot_escape_the_managed_session() {
    let f = Fixture::new(); let first = f.checkpoint(None, TOKEN1, 0, "owned");
    let body = Path::new(&first.root).join(&first.snapshot.unwrap().documents[0].content_file);
    fs::remove_file(&body).unwrap(); std::os::unix::fs::symlink(f.source.join("user.md"), &body).unwrap();
    assert!(f.store.session_read(None).is_err());
    assert_eq!(fs::read_to_string(f.source.join("user.md")).unwrap(), "用户原文\n");
}
