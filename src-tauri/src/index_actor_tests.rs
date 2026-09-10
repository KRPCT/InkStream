use super::worker::{IndexState, Operation, Scope};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::PathBuf;

struct Vault(PathBuf);
impl Vault {
    fn new() -> Self {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("inkstream-index-{}-{nonce}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }
    fn scope(&self, id: &str) -> Scope {
        Scope::new(self.0.to_string_lossy().into_owned(), id.into()).unwrap()
    }
    async fn pool(&self) -> sqlx::SqlitePool {
        SqlitePoolOptions::new().max_connections(1).connect_with(
            SqliteConnectOptions::new().filename(self.0.join(".inkstream/index.db"))
                .busy_timeout(std::time::Duration::from_secs(2)),
        ).await.unwrap()
    }
}
impl Drop for Vault {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

#[test]
fn commit_receipt_is_readable_and_old_scope_cannot_write_another_vault() {
    tauri::async_runtime::block_on(async {
        let a = Vault::new();
        let b = Vault::new();
        let actor = IndexState::start();
        let sa = a.scope("scope-a");
        let sb = b.scope("scope-b");
        actor.submit(sa.clone(), Operation::Prepare { rebuild: true }).await.unwrap();
        actor.submit(sa.clone(), Operation::Upsert { path: "same.md".into(), content: "属于A".into() }).await.unwrap();
        let pa = a.pool().await;
        let saved: String = sqlx::query_scalar("SELECT content FROM files WHERE path='same.md'").fetch_one(&pa).await.unwrap();
        assert_eq!(saved, "属于A"); // Await completion means real SQL commit, not merely enqueue.
        actor.submit(sb.clone(), Operation::Prepare { rebuild: true }).await.unwrap();
        assert!(actor.submit(sa, Operation::Upsert { path: "same.md".into(), content: "迟到A".into() }).await.is_err());
        actor.submit(sb.clone(), Operation::Upsert { path: "same.md".into(), content: "属于B".into() }).await.unwrap();
        let pb = b.pool().await;
        let a_now: String = sqlx::query_scalar("SELECT content FROM files WHERE path='same.md'").fetch_one(&pa).await.unwrap();
        let b_now: String = sqlx::query_scalar("SELECT content FROM files WHERE path='same.md'").fetch_one(&pb).await.unwrap();
        assert_eq!(a_now, "属于A");
        assert_eq!(b_now, "属于B");
        actor.submit(sb, Operation::Stop).await.unwrap();
        pa.close().await;
        pb.close().await;
    });
}

#[test]
fn stopped_token_cannot_reactivate_even_if_its_prepare_arrives_late() {
    tauri::async_runtime::block_on(async {
        let vault = Vault::new();
        let actor = IndexState::start();
        let old = vault.scope("old");
        actor.submit(old.clone(), Operation::Stop).await.unwrap();
        assert!(actor.submit(old, Operation::Prepare { rebuild: true }).await.is_err());
        let fresh = vault.scope("fresh");
        actor.submit(fresh.clone(), Operation::Prepare { rebuild: true }).await.unwrap();
        actor.submit(fresh, Operation::Stop).await.unwrap();
    });
}

#[test]
fn failed_sql_transaction_returns_failure_and_does_not_commit_rows() {
    tauri::async_runtime::block_on(async {
        let vault = Vault::new();
        let actor = IndexState::start();
        let scope = vault.scope("fail-sql");
        actor.submit(scope.clone(), Operation::Prepare { rebuild: true }).await.unwrap();
        let pool = vault.pool().await;
        sqlx::query("CREATE TRIGGER fail_insert BEFORE INSERT ON files BEGIN SELECT RAISE(FAIL, 'fixture failure'); END")
            .execute(&pool).await.unwrap();
        let result = actor.submit(scope.clone(), Operation::Upsert { path: "note.md".into(), content: "不要误报成功".into() }).await;
        assert!(result.is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM files").fetch_one(&pool).await.unwrap();
        assert_eq!(count, 0);
        actor.submit(scope, Operation::Stop).await.unwrap();
        pool.close().await;
    });
}

#[test]
fn index_preserves_distinct_unicode_file_identities() {
    tauri::async_runtime::block_on(async {
        let vault = Vault::new();
        let actor = IndexState::start();
        let scope = vault.scope("unicode-identities");
        actor.submit(scope.clone(), Operation::Prepare { rebuild: true }).await.unwrap();
        for (path, content) in [("Cafe\u{301}.md", "NFD正文"), ("Café.md", "NFC正文")] {
            actor.submit(scope.clone(), Operation::Upsert { path: path.into(), content: content.into() }).await.unwrap();
        }
        let pool = vault.pool().await;
        let rows: Vec<(String, String)> = sqlx::query_as("SELECT path,content FROM files ORDER BY path")
            .fetch_all(&pool).await.unwrap();
        actor.submit(scope, Operation::Stop).await.unwrap();
        pool.close().await;
        assert_eq!(rows.len(), 2);
        assert!(rows.contains(&("Cafe\u{301}.md".into(), "NFD正文".into())));
        assert!(rows.contains(&("Café.md".into(), "NFC正文".into())));
    });
}
