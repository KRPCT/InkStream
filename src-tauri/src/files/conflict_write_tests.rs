use super::stream::{ack_file_read, read_file_stream, FileReadTarget};
use super::write_session::{Limits, WriteSessions};
use crate::git::conflict_snapshot::{git_conflict_snapshot, Baseline, Part};
use crate::git::rebase_test_support::Fixture;
use serde_json::json;
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

const ID: &str = "33333333-3333-4333-8333-333333333333";
fn fixture() -> Fixture {
    let fixture = Fixture::new("conflict-raw");
    fixture.divergent(true, false);
    let result = fixture.git(&["-c", "merge.conflictStyle=diff3", "merge", "--no-gpg-sign", "--no-commit", "upstream"]);
    assert_ne!(result.exit_code, Some(0));
    assert!(fixture.repo().index().unwrap().has_conflicts());
    fixture
}
fn metadata(fixture: &Fixture, baseline: &Baseline, length: usize) -> serde_json::Value {
    json!({"version":1,"requestId":ID,"target":{"kind":"gitConflict","repoRoot":fixture.path(),"path":"note.md","baseline":baseline},"encoding":"utf8","byteLength":length})
}
async fn drained(sessions: &WriteSessions) {
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while sessions.active_count() != 0 { tokio::time::sleep(std::time::Duration::from_millis(5)).await; }
    }).await.expect("conflict sessions must release their files and admission");
}
async fn append(sessions: &WriteSessions, text: &str) {
    for (index, bytes) in text.as_bytes().chunks(256 * 1024).enumerate() {
        sessions.append("owner", ID, (index * 256 * 1024) as u64, bytes.to_vec()).await.unwrap();
    }
}

#[test]
fn large_conflict_roundtrip_uses_raw_ack_preserves_crlf_and_stages_the_exact_resolution() {
    tauri::async_runtime::block_on(async {
        let fixture = fixture();
        let prefix = "unchanged prose\r\n".repeat(75_000);
        let source = format!("{prefix}{}", fixture.body("note.md").replace('\n', "\r\n"));
        std::fs::write(fixture.root.join("note.md"), &source).unwrap();
        let snapshot = git_conflict_snapshot(fixture.path(), "note.md".into()).await.unwrap();
        assert!(snapshot.marker_error.is_none());
        assert_eq!(snapshot.conflict_count, 1);
        assert!(snapshot.baseline.stages.iter().all(Option::is_some));
        let received = Arc::new(Mutex::new(Vec::new()));
        let captured = received.clone();
        let channel = Channel::new(move |message| {
            match message {
                InvokeResponseBody::Raw(frame) => {
                    assert!(frame.len() <= 256 * 1024 + 8);
                    let mut bytes = captured.lock().unwrap();
                    assert_eq!(u64::from_le_bytes(frame[..8].try_into().unwrap()) as usize, bytes.len());
                    bytes.extend_from_slice(&frame[8..]);
                    ack_file_read("conflict-raw-roundtrip".into(), bytes.len() as u64).unwrap();
                }
                InvokeResponseBody::Json(value) => assert!(value.len() < 4096),
            }
            Ok(())
        });
        read_file_stream("conflict-raw-roundtrip".into(), FileReadTarget::GitConflict { repo_root: fixture.path(), path: "note.md".into(), baseline: snapshot.baseline.clone(), part: Part::Working }, channel).await.unwrap();
        assert_eq!(*received.lock().unwrap(), source.as_bytes());
        let base = crate::git::conflict_snapshot::read(&fixture.path(), "note.md", &snapshot.baseline, Part::Base).unwrap();
        assert_eq!(base, "共同稿\n".as_bytes());
        let resolved = format!("{prefix}final choice\r\n");
        let sessions = Arc::new(WriteSessions::new(Limits::default()));
        sessions.begin("owner", metadata(&fixture, &snapshot.baseline, resolved.len())).await.unwrap();
        append(&sessions, &resolved).await;
        assert_eq!(fixture.body("note.md"), source, "uploading must not publish early");
        sessions.commit("owner", ID).await.unwrap();
        drained(&sessions).await;
        assert_eq!(fixture.body("note.md"), resolved);
        let repo = fixture.repo();
        let index = repo.index().unwrap();
        assert!(!index.has_conflicts());
        let staged = index.get_path(std::path::Path::new("note.md"), 0).unwrap();
        assert_eq!(repo.find_blob(staged.id).unwrap().content(), resolved.as_bytes());
    });
}

#[test]
fn damaged_source_or_result_never_writes_or_stages_and_a_stale_baseline_is_rejected() {
    tauri::async_runtime::block_on(async {
        let fixture = fixture();
        let original = fixture.body("note.md");
        let sessions = Arc::new(WriteSessions::new(Limits::default()));
        let invalid = "<<<<<<< ours\nmissing separators\n";
        std::fs::write(fixture.root.join("note.md"), invalid).unwrap();
        let snapshot = git_conflict_snapshot(fixture.path(), "note.md".into()).await.unwrap();
        assert!(snapshot.marker_error.is_some());
        assert!(sessions.begin("owner", metadata(&fixture, &snapshot.baseline, 0)).await.is_err());
        assert_eq!(fixture.body("note.md"), invalid);
        assert!(fixture.repo().index().unwrap().has_conflicts());
        std::fs::write(fixture.root.join("note.md"), &original).unwrap();
        let snapshot = git_conflict_snapshot(fixture.path(), "note.md".into()).await.unwrap();
        sessions.begin("owner", metadata(&fixture, &snapshot.baseline, invalid.len())).await.unwrap();
        append(&sessions, invalid).await;
        assert!(sessions.commit("owner", ID).await.is_err());
        drained(&sessions).await;
        assert_eq!(fixture.body("note.md"), original);
        assert!(fixture.repo().index().unwrap().has_conflicts());
        sessions.begin("owner", metadata(&fixture, &snapshot.baseline, 8)).await.unwrap();
        append(&sessions, "resolved").await;
        std::fs::write(fixture.root.join("note.md"), "newer external edit").unwrap();
        assert!(sessions.commit("owner", ID).await.is_err());
        drained(&sessions).await;
        assert_eq!(fixture.body("note.md"), "newer external edit");
        assert!(fixture.repo().index().unwrap().has_conflicts());
        assert!(crate::git::conflict_snapshot::read(&fixture.path(), "note.md", &snapshot.baseline, Part::Ours).is_err());
    });
}

#[test]
fn cancelled_conflict_upload_releases_the_git_lease_without_changing_either_baseline() {
    tauri::async_runtime::block_on(async {
        let fixture = fixture();
        let original = fixture.body("note.md");
        let snapshot = git_conflict_snapshot(fixture.path(), "note.md".into()).await.unwrap();
        let sessions = Arc::new(WriteSessions::new(Limits::default()));
        sessions.begin("owner", metadata(&fixture, &snapshot.baseline, 1_000_000)).await.unwrap();
        sessions.append("owner", ID, 0, vec![b'x'; 256 * 1024]).await.unwrap();
        assert!(sessions.abort("other-owner", ID).is_err());
        sessions.abort("owner", ID).unwrap();
        drained(&sessions).await;
        assert_eq!(fixture.body("note.md"), original);
        assert!(fixture.repo().index().unwrap().has_conflicts());
        sessions.begin("owner", metadata(&fixture, &snapshot.baseline, 0)).await.unwrap();
        sessions.abort("owner", ID).unwrap();
        drained(&sessions).await;
    });
}
