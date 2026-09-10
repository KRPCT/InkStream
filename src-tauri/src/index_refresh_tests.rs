use super::worker::{IndexState, Operation, Scope};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::PathBuf;

struct Vault(PathBuf);
impl Vault {
    fn new() -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "inkstream-index-refresh-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }
    fn scope(&self, id: &str) -> Scope {
        Scope::new(self.0.to_string_lossy().into_owned(), id.into()).unwrap()
    }
    async fn pool(&self) -> SqlitePool {
        SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(self.0.join(".inkstream/index.db"))
                    .busy_timeout(std::time::Duration::from_secs(2)),
            )
            .await
            .unwrap()
    }
}
impl Drop for Vault {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
async fn body(pool: &SqlitePool, path: &str) -> Option<String> {
    sqlx::query_scalar("SELECT content FROM files WHERE path=?")
        .bind(path)
        .fetch_optional(pool)
        .await
        .unwrap()
}
async fn stop(actor: &IndexState, scope: Scope, pool: SqlitePool) {
    actor.submit(scope, Operation::Stop).await.unwrap();
    pool.close().await;
}

#[test]
fn refresh_reads_the_saved_file_and_only_confirms_after_sql_commit() {
    tauri::async_runtime::block_on(async {
        let vault = Vault::new();
        let actor = IndexState::start();
        let scope = vault.scope("saved-file");
        actor
            .submit(scope.clone(), Operation::Prepare { rebuild: false })
            .await
            .unwrap();
        actor
            .submit(
                scope.clone(),
                Operation::Upsert {
                    path: "other.md".into(),
                    content: "previous unrelated snapshot".into(),
                },
            )
            .await
            .unwrap();
        std::fs::write(vault.0.join("other.md"), "different unrelated disk text").unwrap();
        let text = format!("# 已落盘\n\n{}TAIL", "中文🙂\n".repeat(150_000));
        std::fs::write(vault.0.join("中文.md"), &text).unwrap();
        let result = actor
            .submit(
                scope.clone(),
                Operation::Refresh {
                    path: "中文.md".into(),
                },
            )
            .await;
        let pool = vault.pool().await;
        let indexed = body(&pool, "中文.md").await;
        let unrelated = body(&pool, "other.md").await;
        stop(&actor, scope, pool).await;
        assert!(result.is_ok(), "{result:?}");
        assert!(
            indexed.as_deref() == Some(text.as_str()),
            "receipt preceded the complete target row"
        );
        assert_eq!(unrelated.as_deref(), Some("previous unrelated snapshot"));
    });
}

#[test]
fn missing_and_invalid_utf8_files_fail_without_replacing_the_last_committed_row() {
    tauri::async_runtime::block_on(async {
        let vault = Vault::new();
        let actor = IndexState::start();
        let scope = vault.scope("failed-read");
        actor
            .submit(scope.clone(), Operation::Prepare { rebuild: false })
            .await
            .unwrap();
        actor
            .submit(
                scope.clone(),
                Operation::Upsert {
                    path: "note.md".into(),
                    content: "last complete row".into(),
                },
            )
            .await
            .unwrap();
        std::fs::write(vault.0.join("note.md"), "last complete row").unwrap();
        std::fs::remove_file(vault.0.join("note.md")).unwrap();
        let missing = actor
            .submit(
                scope.clone(),
                Operation::Refresh {
                    path: "note.md".into(),
                },
            )
            .await;
        std::fs::write(vault.0.join("note.md"), [255, 254]).unwrap();
        let invalid = actor
            .submit(
                scope.clone(),
                Operation::Refresh {
                    path: "note.md".into(),
                },
            )
            .await;
        let pool = vault.pool().await;
        let indexed = body(&pool, "note.md").await;
        stop(&actor, scope, pool).await;
        assert!(
            missing.is_err(),
            "missing file must not be treated as an empty success"
        );
        assert!(
            invalid.is_err(),
            "invalid UTF-8 must not be silently skipped"
        );
        assert_eq!(indexed.as_deref(), Some("last complete row"));
    });
}

#[test]
fn retired_scope_cannot_refresh_its_path_into_the_current_vault() {
    tauri::async_runtime::block_on(async {
        let a = Vault::new();
        let b = Vault::new();
        let actor = IndexState::start();
        let sa = a.scope("refresh-a");
        let sb = b.scope("refresh-b");
        std::fs::write(a.0.join("same.md"), "A disk").unwrap();
        std::fs::write(b.0.join("same.md"), "B disk").unwrap();
        actor
            .submit(sa.clone(), Operation::Prepare { rebuild: false })
            .await
            .unwrap();
        actor
            .submit(
                sa.clone(),
                Operation::Refresh {
                    path: "same.md".into(),
                },
            )
            .await
            .unwrap();
        actor
            .submit(sb.clone(), Operation::Prepare { rebuild: false })
            .await
            .unwrap();
        std::fs::write(a.0.join("same.md"), "late A disk").unwrap();
        let late = actor
            .submit(
                sa,
                Operation::Refresh {
                    path: "same.md".into(),
                },
            )
            .await;
        actor
            .submit(
                sb.clone(),
                Operation::Refresh {
                    path: "same.md".into(),
                },
            )
            .await
            .unwrap();
        let pa = a.pool().await;
        let pb = b.pool().await;
        let row_a = body(&pa, "same.md").await;
        let row_b = body(&pb, "same.md").await;
        stop(&actor, sb, pb).await;
        pa.close().await;
        assert!(late.is_err());
        assert_eq!(row_a.as_deref(), Some("A disk"));
        assert_eq!(row_b.as_deref(), Some("B disk"));
    });
}

#[test]
fn refresh_rejects_non_relative_paths_and_non_files() {
    tauri::async_runtime::block_on(async {
        let vault = Vault::new();
        let outside = Vault::new();
        let actor = IndexState::start();
        let scope = vault.scope("refresh-path-guards");
        actor
            .submit(scope.clone(), Operation::Prepare { rebuild: false })
            .await
            .unwrap();
        std::fs::write(outside.0.join("outside.md"), "outside content").unwrap();
        std::fs::create_dir(vault.0.join("directory.md")).unwrap();
        let mut results = Vec::new();
        for path in [
            "../escape.md".into(),
            outside.0.join("outside.md").to_string_lossy().into_owned(),
            "directory.md".into(),
        ] {
            results.push(
                actor
                    .submit(scope.clone(), Operation::Refresh { path })
                    .await,
            );
        }
        let pool = vault.pool().await;
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM files")
            .fetch_one(&pool)
            .await
            .unwrap();
        stop(&actor, scope, pool).await;
        assert!(results.iter().all(Result::is_err));
        assert_eq!(count, 0);
    });
}

#[test]
fn oversized_saved_file_is_an_explicit_error_instead_of_a_silent_skip() {
    tauri::async_runtime::block_on(async {
        let vault = Vault::new();
        let actor = IndexState::start();
        let scope = vault.scope("refresh-size-guard");
        actor
            .submit(scope.clone(), Operation::Prepare { rebuild: false })
            .await
            .unwrap();
        let file = std::fs::File::create(vault.0.join("large.md")).unwrap();
        file.set_len(100 * 1024 * 1024 + 1).unwrap();
        drop(file);
        let result = actor
            .submit(
                scope.clone(),
                Operation::Refresh {
                    path: "large.md".into(),
                },
            )
            .await;
        let pool = vault.pool().await;
        let indexed = body(&pool, "large.md").await;
        stop(&actor, scope, pool).await;
        assert!(result.unwrap_err().contains("100MiB"));
        assert!(indexed.is_none());
    });
}

#[test]
fn refresh_sql_failure_returns_error_and_preserves_the_previous_commit() {
    tauri::async_runtime::block_on(async {
        let vault = Vault::new();
        let actor = IndexState::start();
        let scope = vault.scope("refresh-sql-error");
        actor
            .submit(scope.clone(), Operation::Prepare { rebuild: false })
            .await
            .unwrap();
        actor
            .submit(
                scope.clone(),
                Operation::Upsert {
                    path: "note.md".into(),
                    content: "previous commit".into(),
                },
            )
            .await
            .unwrap();
        std::fs::write(vault.0.join("note.md"), "new disk text").unwrap();
        let pool = vault.pool().await;
        sqlx::query("CREATE TRIGGER reject_refresh BEFORE INSERT ON files BEGIN SELECT RAISE(FAIL,'fixture write denied'); END")
            .execute(&pool).await.unwrap();
        let result = actor
            .submit(
                scope.clone(),
                Operation::Refresh {
                    path: "note.md".into(),
                },
            )
            .await;
        let indexed = body(&pool, "note.md").await;
        stop(&actor, scope, pool).await;
        assert!(result.is_err());
        assert_eq!(indexed.as_deref(), Some("previous commit"));
    });
}

#[cfg(unix)]
#[test]
fn refresh_does_not_follow_a_symlink_outside_the_owned_vault() {
    tauri::async_runtime::block_on(async {
        let vault = Vault::new();
        let outside = Vault::new();
        let actor = IndexState::start();
        let scope = vault.scope("refresh-symlink");
        actor
            .submit(scope.clone(), Operation::Prepare { rebuild: false })
            .await
            .unwrap();
        std::fs::write(outside.0.join("outside.md"), "not owned").unwrap();
        std::os::unix::fs::symlink(outside.0.join("outside.md"), vault.0.join("link.md")).unwrap();
        let result = actor
            .submit(
                scope.clone(),
                Operation::Refresh {
                    path: "link.md".into(),
                },
            )
            .await;
        let pool = vault.pool().await;
        let indexed = body(&pool, "link.md").await;
        stop(&actor, scope, pool).await;
        assert!(result.is_err());
        assert!(indexed.is_none());
    });
}
