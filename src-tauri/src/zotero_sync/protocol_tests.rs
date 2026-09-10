use super::*;

fn envelope(key: &str, csl_id: &str, citekey: &str, title: &str, version: i64) -> Value {
    serde_json::json!({
        "key": key, "version": version,
        "data": { "key": key, "version": version, "itemType": "journalArticle", "citationKey": citekey },
        "csljson": paper(csl_id, citekey, title),
    })
}

#[test]
fn deleted_item_keys_remove_entries_even_when_the_csl_identifier_is_a_uri() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let api = Api::new(vec![
            Reply::library_items(
                1,
                1,
                vec![envelope(
                    "ABCDEFGH",
                    "http://zotero.org/users/101/items/ABCDEFGH",
                    "paperA",
                    "Delete me",
                    1,
                )],
            ),
            Reply::deleted(1, &[]),
            Reply::library_items(2, 0, vec![]),
            Reply::deleted(2, &["ABCDEFGH"]),
        ]);
        let pool = open_cache_at(&sandbox.0, "101").await.unwrap();
        let first = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let second = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let visible = titles(&pool, &["paperA"]).await;
        pool.close().await;
        assert!(first.is_ok(), "initial download failed: {first:?}");
        assert_eq!(second.unwrap().removed, 1);
        assert!(visible.is_empty());
    });
}

#[test]
fn changing_a_citation_key_replaces_the_same_item_and_repeated_sync_is_idempotent() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let api = Api::new(vec![
            Reply::library_items(
                1,
                1,
                vec![envelope(
                    "ABCDEFGH",
                    "oldCitationKey",
                    "oldCitationKey",
                    "Before",
                    1,
                )],
            ),
            Reply::deleted(1, &[]),
            Reply::library_items(
                2,
                1,
                vec![envelope(
                    "ABCDEFGH",
                    "newCitationKey",
                    "newCitationKey",
                    "After",
                    2,
                )],
            ),
            Reply::deleted(2, &[]),
            Reply::library_items(2, 0, vec![]),
            Reply::deleted(2, &[]),
        ]);
        let pool = open_cache_at(&sandbox.0, "101").await.unwrap();
        let first = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let second = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let third = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let visible = titles(&pool, &["oldCitationKey", "newCitationKey"]).await;
        pool.close().await;
        assert!(first.is_ok(), "initial download failed: {first:?}");
        assert!(second.is_ok(), "citation-key update failed: {second:?}");
        let repeated = third.unwrap();
        assert_eq!(
            (repeated.version, repeated.synced, repeated.removed),
            (2, 0, 0)
        );
        assert_eq!(visible, vec!["After"]);
    });
}

#[test]
fn moving_a_reference_to_zotero_trash_removes_it_from_the_citable_cache() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let mut trashed = envelope("ABCDEFGH", "paperA", "paperA", "In trash", 2);
        trashed["data"]["deleted"] = Value::from(1);
        let api = Api::new(vec![
            Reply::library_items(
                1,
                1,
                vec![envelope("ABCDEFGH", "paperA", "paperA", "Before trash", 1)],
            ),
            Reply::deleted(1, &[]),
            Reply::library_items(2, 1, vec![trashed]),
            Reply::deleted(2, &[]),
        ]);
        let pool = open_cache_at(&sandbox.0, "101").await.unwrap();
        let first = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let second = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let visible = titles(&pool, &["paperA"]).await;
        let requests = api.requests();
        pool.close().await;
        assert!(
            first.is_ok(),
            "initial download failed: {first:?}; fixture={:?}; requests={requests:?}",
            api.diagnostics()
        );
        assert!(
            second.is_ok(),
            "trash update failed: {second:?}; fixture={:?}; requests={requests:?}",
            api.diagnostics()
        );
        assert!(visible.is_empty());
        assert!(requests[2].contains("includeTrashed=1"));
    });
}
