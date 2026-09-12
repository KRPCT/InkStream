use super::write_session::{Limits, WriteSessions};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

struct Fixture {
    path: PathBuf,
    sessions: Arc<WriteSessions>,
}
impl Fixture {
    fn new() -> Self {
        Self::with_limits(Limits::default())
    }
    fn with_limits(limits: Limits) -> Self {
        let path = std::env::temp_dir().join(format!(
            "inkstream-write-session-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("existing.md"), b"original").unwrap();
        Self {
            path,
            sessions: Arc::new(WriteSessions::new(limits)),
        }
    }
    fn spec(&self, id: &str, encoding: &str, length: usize) -> Value {
        json!({"version":1, "requestId":id, "target":{"kind":"vault", "root":self.path.to_string_lossy(), "path":"existing.md"}, "encoding":encoding, "byteLength":length})
    }
    async fn drained(&self) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while self.sessions.active_count() != 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("session workers did not release their owned files and slots");
        assert!(!std::fs::read_dir(&self.path).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".inkstream-tmp-")));
    }
    fn original(&self) {
        assert_eq!(
            std::fs::read(self.path.join("existing.md")).unwrap(),
            b"original"
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.sessions.close_owner("window-a");
        self.sessions.close_owner("window-b");
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

const ID: &str = "11111111-1111-4111-8111-111111111111";
const OTHER: &str = "22222222-2222-4222-8222-222222222222";

#[test]
fn session_publishes_only_after_full_utf8_commit_and_preserves_split_characters() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        let text = format!("\u{feff}{}TAIL", "墨🙂\n".repeat(160_000));
        f.sessions
            .begin("window-a", f.spec(ID, "utf8", text.len()))
            .await
            .unwrap();
        let mut offset = 0;
        for chunk in text.as_bytes().chunks(256 * 1024) {
            f.sessions
                .append("window-a", ID, offset, chunk.to_vec())
                .await
                .unwrap();
            offset += chunk.len() as u64;
            f.original();
        }
        f.sessions.commit("window-a", ID).await.unwrap();
        f.drained().await;
        assert_eq!(
            std::fs::read(f.path.join("existing.md")).unwrap(),
            text.as_bytes()
        );
    });
}

#[test]
fn oversized_raw_chunk_is_rejected_without_publishing_or_leaking_a_temp() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        f.sessions
            .begin("window-a", f.spec(ID, "bytes", 256 * 1024 + 1))
            .await
            .unwrap();
        let result = f
            .sessions
            .append("window-a", ID, 0, vec![5; 256 * 1024 + 1])
            .await;
        // Complete the existing path too: an absent size guard must produce a behavioral RED.
        if result.is_ok() {
            let _ = f.sessions.commit("window-a", ID).await;
        }
        f.drained().await;
        assert!(result.is_err(), "native accepted a Raw chunk above 256 KiB");
        f.original();
    });
}

#[test]
fn wrong_or_repeated_offsets_cancel_the_session_and_preserve_the_original() {
    tauri::async_runtime::block_on(async {
        for bad_offset in [0, 4] {
            let f = Fixture::new();
            f.sessions
                .begin("window-a", f.spec(ID, "bytes", 6))
                .await
                .unwrap();
            f.sessions
                .append("window-a", ID, 0, b"abc".to_vec())
                .await
                .unwrap();
            let result = f
                .sessions
                .append("window-a", ID, bad_offset, b"def".to_vec())
                .await;
            if result.is_ok() {
                let _ = f.sessions.commit("window-a", ID).await;
            }
            f.drained().await;
            assert!(result.is_err(), "duplicate or missing bytes were accepted");
            f.original();
        }
    });
}

#[test]
fn incomplete_length_invalid_utf8_and_unfinished_multibyte_tail_cannot_commit() {
    tauri::async_runtime::block_on(async {
        for (length, body) in [(8, b"new".to_vec()), (1, vec![255]), (2, vec![0xe4, 0xb8])] {
            let f = Fixture::new();
            f.sessions
                .begin("window-a", f.spec(ID, "utf8", length))
                .await
                .unwrap();
            let append = f.sessions.append("window-a", ID, 0, body).await;
            let commit = f.sessions.commit("window-a", ID).await;
            assert!(append.is_err() || commit.is_err());
            f.drained().await;
            f.original();
        }
    });
}

#[test]
fn empty_text_and_arbitrary_binary_use_the_same_atomic_session_contract() {
    tauri::async_runtime::block_on(async {
        for (encoding, body) in [("utf8", Vec::new()), ("bytes", vec![0, 255, 128, 65])] {
            let f = Fixture::new();
            let mut spec = f.spec(ID, encoding, body.len());
            spec["target"] =
                json!({"kind":"absolute", "path":f.path.join("export.docx").to_string_lossy()});
            f.sessions.begin("window-a", spec).await.unwrap();
            if !body.is_empty() {
                f.sessions
                    .append("window-a", ID, 0, body.clone())
                    .await
                    .unwrap();
            }
            f.sessions.commit("window-a", ID).await.unwrap();
            f.drained().await;
            assert_eq!(std::fs::read(f.path.join("export.docx")).unwrap(), body);
            f.original();
        }
    });
}

#[test]
fn explicit_abort_and_owner_close_remove_only_their_own_unpublished_writes() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        f.sessions
            .begin("window-a", f.spec(ID, "utf8", 3))
            .await
            .unwrap();
        let mut other = f.spec(OTHER, "utf8", 3);
        other["target"]["path"] = json!("other.md");
        f.sessions.begin("window-b", other).await.unwrap();
        f.sessions
            .append("window-a", ID, 0, b"new".to_vec())
            .await
            .unwrap();
        f.sessions.close_owner("window-a");
        assert!(f.sessions.commit("window-a", ID).await.is_err());
        f.sessions
            .append("window-b", OTHER, 0, b"yes".to_vec())
            .await
            .unwrap();
        f.sessions.commit("window-b", OTHER).await.unwrap();
        f.drained().await;
        f.original();
        assert_eq!(std::fs::read(f.path.join("other.md")).unwrap(), b"yes");
        f.sessions
            .begin("window-a", f.spec(ID, "bytes", 4))
            .await
            .unwrap();
        f.sessions
            .append("window-a", ID, 0, vec![1, 2])
            .await
            .unwrap();
        f.sessions.abort("window-a", ID).unwrap();
        assert!(f.sessions.commit("window-a", ID).await.is_err());
        f.drained().await;
        f.original();
    });
}

#[test]
fn idle_and_total_deadlines_expire_without_another_frontend_message() {
    tauri::async_runtime::block_on(async {
        let idle = Fixture::with_limits(Limits {
            maximum: 4,
            total: Duration::from_secs(1),
            idle: Duration::from_millis(35),
        });
        idle.sessions
            .begin("window-a", idle.spec(ID, "bytes", 1))
            .await
            .unwrap();
        idle.drained().await;
        assert!(idle.sessions.commit("window-a", ID).await.is_err());
        idle.original();

        let total = Fixture::with_limits(Limits {
            maximum: 4,
            total: Duration::from_millis(100),
            idle: Duration::from_millis(60),
        });
        total
            .sessions
            .begin("window-a", total.spec(ID, "bytes", 1000))
            .await
            .unwrap();
        let mut offset = 0;
        for _ in 0..12 {
            tokio::time::sleep(Duration::from_millis(20)).await;
            if total
                .sessions
                .append("window-a", ID, offset, vec![42])
                .await
                .is_err()
            {
                break;
            }
            offset += 1;
        }
        total.drained().await;
        assert!(total.sessions.commit("window-a", ID).await.is_err());
        total.original();
    });
}

#[test]
fn sessions_have_finite_admission_and_cannot_be_modified_by_another_window() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::with_limits(Limits {
            maximum: 1,
            ..Limits::default()
        });
        f.sessions
            .begin("window-a", f.spec(ID, "bytes", 1))
            .await
            .unwrap();
        assert!(f
            .sessions
            .begin("window-a", f.spec(OTHER, "bytes", 1))
            .await
            .is_err());
        assert!(f.sessions.append("window-b", ID, 0, vec![0]).await.is_err());
        assert!(f.sessions.commit("window-b", ID).await.is_err());
        assert!(f.sessions.abort("window-b", ID).is_err());
        f.sessions
            .append("window-a", ID, 0, vec![42])
            .await
            .unwrap();
        f.sessions.commit("window-a", ID).await.unwrap();
        f.drained().await;
        assert_eq!(std::fs::read(f.path.join("existing.md")).unwrap(), vec![42]);
    });
}

#[test]
fn metadata_and_path_guards_run_before_any_owned_temp_is_created() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        let mut version = f.spec(ID, "utf8", 0);
        version["version"] = json!(2);
        let mut oversized = f.spec(ID, "utf8", 0);
        oversized["padding"] = json!("x".repeat(256 * 1024));
        let mut relative = f.spec(ID, "utf8", 0);
        relative["target"] = json!({"kind":"absolute", "path":"relative.md"});
        let mut escape = f.spec(ID, "utf8", 0);
        escape["target"]["path"] = json!("../escape.md");
        for spec in [version, oversized, relative, escape] {
            assert!(f.sessions.begin("window-a", spec).await.is_err());
        }
        f.drained().await;
        f.original();
    });
}

#[test]
fn failed_session_rename_keeps_the_existing_directory_and_cleans_its_temp() {
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        std::fs::create_dir(f.path.join("blocked.md")).unwrap();
        std::fs::write(f.path.join("blocked.md/original"), b"directory contents").unwrap();
        let mut spec = f.spec(ID, "utf8", 3);
        spec["target"]["path"] = json!("blocked.md");
        f.sessions.begin("window-a", spec).await.unwrap();
        f.sessions
            .append("window-a", ID, 0, b"new".to_vec())
            .await
            .unwrap();
        assert!(f
            .sessions
            .commit("window-a", ID)
            .await
            .unwrap_err()
            .contains("rename"));
        f.drained().await;
        assert_eq!(
            std::fs::read(f.path.join("blocked.md/original")).unwrap(),
            b"directory contents"
        );
        f.original();
    });
}

#[cfg(unix)]
#[test]
fn session_permissions_preserve_private_and_executable_modes_and_new_file_defaults() {
    use std::os::unix::fs::PermissionsExt;
    tauri::async_runtime::block_on(async {
        let f = Fixture::new();
        for mode in [0o600, 0o751, 0o755] {
            std::fs::set_permissions(
                f.path.join("existing.md"),
                std::fs::Permissions::from_mode(mode),
            )
            .unwrap();
            f.sessions
                .begin("window-a", f.spec(ID, "utf8", 3))
                .await
                .unwrap();
            f.sessions
                .append("window-a", ID, 0, b"new".to_vec())
                .await
                .unwrap();
            f.sessions.commit("window-a", ID).await.unwrap();
            f.drained().await;
            assert_eq!(
                std::fs::metadata(f.path.join("existing.md"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o7777,
                mode
            );
        }
        std::fs::write(f.path.join("control.md"), b"control").unwrap();
        let mut spec = f.spec(ID, "utf8", 0);
        spec["target"]["path"] = json!("new.md");
        f.sessions.begin("window-a", spec).await.unwrap();
        f.sessions.commit("window-a", ID).await.unwrap();
        f.drained().await;
        assert_eq!(
            std::fs::metadata(f.path.join("new.md"))
                .unwrap()
                .permissions()
                .mode()
                & 0o7777,
            std::fs::metadata(f.path.join("control.md"))
                .unwrap()
                .permissions()
                .mode()
                & 0o7777
        );
    });
}
