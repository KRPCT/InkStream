use super::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

#[path = "test_http.rs"]
mod http;
use http::{Api, Reply};

struct Sandbox(PathBuf);

impl Sandbox {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "inkstream-zotero-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for Sandbox {
    fn drop(&mut self) {
        // This exact, uniquely-created directory contains only this test's caches.
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn credentials(user: &str) -> Creds {
    Creds {
        api_key: "fixture-key-not-a-real-credential".into(),
        user_id: user.into(),
    }
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap()
}

fn paper(id: &str, citekey: &str, title: &str) -> Value {
    serde_json::json!({ "id": id, "citation-key": citekey, "title": title, "type": "article-journal" })
}

fn hundred_items(first: Value) -> Vec<Value> {
    let mut items = vec![first];
    for index in 1..100 {
        items.push(serde_json::json!({ "id": format!("FILLER_{index}"), "title": "Uncitable fixture item" }));
    }
    items
}

async fn titles(pool: &SqlitePool, keys: &[&str]) -> Vec<String> {
    cached_csl(pool, keys.iter().map(|key| key.to_string()).collect())
        .await
        .unwrap()
        .into_iter()
        .map(|item| item["title"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn switching_accounts_starts_the_new_library_at_zero_and_keeps_both_caches_separate() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let api = Api::new(vec![
            Reply::items(1000, 1, vec![paper("KEY_A", "paperA", "Account A")]),
            Reply::deleted(1000, &[]),
            Reply::items(10, 1, vec![paper("KEY_B", "paperB", "Account B")]),
            Reply::deleted(10, &[]),
        ]);
        let client = client();
        let a = open_cache_at(&sandbox.0, "101").await.unwrap();
        sync_library(&client, &credentials("101"), &a, &api.base)
            .await
            .unwrap();
        let b = open_cache_at(&sandbox.0, "202").await.unwrap();
        sync_library(&client, &credentials("202"), &b, &api.base)
            .await
            .unwrap();
        let a_titles = titles(&a, &["paperA", "paperB"]).await;
        let b_titles = titles(&b, &["paperA", "paperB"]).await;
        let requests = api.requests();
        a.close().await;
        b.close().await;
        assert!(
            requests[2].contains("/users/202/items?") && requests[2].contains("&since=0&"),
            "new account request: {}",
            requests[2]
        );
        assert_eq!(a_titles, vec!["Account A"]);
        assert_eq!(b_titles, vec!["Account B"]);
    });
}

#[test]
fn deletion_download_failure_preserves_the_last_complete_cache_and_cursor() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let api = Api::new(vec![
            Reply::items(5, 1, vec![paper("KEY_A", "paperA", "Committed")]),
            Reply::deleted(5, &[]),
            Reply::items(6, 1, vec![paper("KEY_B", "paperB", "Not committed")]),
            Reply::failure(),
        ]);
        let pool = open_cache_at(&sandbox.0, "101").await.unwrap();
        let client = client();
        sync_library(&client, &credentials("101"), &pool, &api.base)
            .await
            .unwrap();
        let failed = sync_library(&client, &credentials("101"), &pool, &api.base).await;
        let visible = titles(&pool, &["paperA", "paperB"]).await;
        let cursor = get_version(&pool).await.unwrap();
        pool.close().await;
        assert!(
            failed.is_err(),
            "deletion failure must fail the whole synchronization"
        );
        assert_eq!(cursor, 5);
        assert_eq!(visible, vec!["Committed"]);
    });
}

#[test]
fn changing_page_versions_restarts_the_download_before_committing() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let api = Api::new(vec![
            Reply::items(
                1,
                101,
                hundred_items(paper("OLD_A", "oldA", "Discarded first page")),
            ),
            Reply::items(
                2,
                101,
                vec![paper("OLD_B", "oldB", "Discarded second page")],
            ),
            Reply::items(3, 1, vec![paper("KEY_C", "paperC", "Consistent snapshot")]),
            Reply::deleted(3, &[]),
        ]);
        let pool = open_cache_at(&sandbox.0, "101").await.unwrap();
        let result = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let visible = titles(&pool, &["oldA", "oldB", "paperC"]).await;
        let requests = api.requests();
        pool.close().await;
        assert_eq!(result.unwrap().version, 3);
        assert!(requests[2].contains("/items?") && requests[2].contains("&since=0&start=0&"));
        assert_eq!(visible, vec!["Consistent snapshot"]);
    });
}

#[path = "protocol_tests.rs"]
mod protocol_tests;

#[path = "failure_tests.rs"]
mod failure_tests;

#[test]
fn continually_changing_pages_stop_without_committing_a_partial_library() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let mut replies = Vec::new();
        for version in [1, 3, 5] {
            replies.push(Reply::items(
                version,
                101,
                hundred_items(paper("A", "paperA", "Partial")),
            ));
            replies.push(Reply::items(
                version + 1,
                101,
                vec![paper("B", "paperB", "Partial")],
            ));
        }
        let api = Api::new(replies);
        let pool = open_cache_at(&sandbox.0, "101").await.unwrap();
        let result = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let visible = titles(&pool, &["paperA", "paperB"]).await;
        let requests = api.requests();
        let cursor = get_version(&pool).await.unwrap();
        pool.close().await;
        assert!(
            result.is_err(),
            "a perpetually changing library must stop with an error"
        );
        assert!(
            requests.len() <= 6,
            "at most three two-page attempts are allowed"
        );
        assert_eq!(cursor, 0);
        assert!(visible.is_empty());
    });
}

#[test]
fn legacy_cache_with_unknown_owner_is_preserved_but_not_assigned_to_a_new_account() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let legacy_path = sandbox.0.join("zotero-cache.db");
        let legacy = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::new()
                    .filename(&legacy_path)
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::raw_sql(SCHEMA).execute(&legacy).await.unwrap();
        sqlx::query(
            "INSERT INTO zotero_items(zkey,citekey,version,csl) VALUES('UNKNOWN','unknown',1000,?)",
        )
        .bind(paper("UNKNOWN", "unknown", "Legacy owner unknown").to_string())
        .execute(&legacy)
        .await
        .unwrap();
        sqlx::query("INSERT INTO zotero_meta(k,v) VALUES('library_version','1000')")
            .execute(&legacy)
            .await
            .unwrap();
        let current = open_cache_at(&sandbox.0, "202").await.unwrap();
        let current_titles = titles(&current, &["unknown"]).await;
        let current_cursor = get_version(&current).await.unwrap();
        let legacy_titles = titles(&legacy, &["unknown"]).await;
        legacy.close().await;
        current.close().await;
        assert!(
            current_titles.is_empty(),
            "unowned legacy entries must not appear under the new account"
        );
        assert_eq!(current_cursor, 0);
        assert_eq!(legacy_titles, vec!["Legacy owner unknown"]);
        assert!(legacy_path.is_file());
    });
}
