use super::*;

#[test]
fn sqlite_write_failure_rolls_back_all_entries_deletions_and_the_cursor() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let api = Api::new(vec![
            Reply::items(
                1,
                1,
                vec![paper("ORIGIN00", "original", "Last complete cache")],
            ),
            Reply::deleted(1, &[]),
            Reply::items(
                2,
                2,
                vec![
                    paper("GOODKEY0", "good", "Must roll back"),
                    paper("BADKEY00", "bad", "Rejected by SQLite"),
                ],
            ),
            Reply::deleted(2, &["ORIGIN00"]),
        ]);
        let pool = open_cache_at(&sandbox.0, "101").await.unwrap();
        let first = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        // A real SQLite failure after the first row was written exercises transaction rollback.
        sqlx::raw_sql(
            "CREATE TRIGGER reject_fixture_entry BEFORE INSERT ON zotero_items \
            WHEN NEW.zkey='BADKEY00' BEGIN SELECT RAISE(FAIL,'fixture write denied'); END;",
        )
        .execute(&pool)
        .await
        .unwrap();
        let failed = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let visible = titles(&pool, &["original", "good", "bad"]).await;
        let cursor = get_version(&pool).await.unwrap();
        pool.close().await;
        assert!(first.is_ok());
        assert!(failed.is_err());
        assert_eq!(cursor, 1);
        assert_eq!(visible, vec!["Last complete cache"]);
    });
}

#[test]
fn malformed_successful_deletion_response_does_not_advance_the_cursor() {
    tauri::async_runtime::block_on(async {
        let sandbox = Sandbox::new();
        let mut malformed = Reply::deleted(2, &[]);
        malformed.body = serde_json::json!({ "items": "invalid deletion list" });
        let api = Api::new(vec![
            Reply::items(
                1,
                1,
                vec![paper("ORIGIN00", "original", "Last complete cache")],
            ),
            Reply::deleted(1, &[]),
            Reply::items(2, 1, vec![paper("NEWKEY00", "new", "Not committed")]),
            malformed,
        ]);
        let pool = open_cache_at(&sandbox.0, "101").await.unwrap();
        let first = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let failed = sync_library(&client(), &credentials("101"), &pool, &api.base).await;
        let visible = titles(&pool, &["original", "new"]).await;
        let cursor = get_version(&pool).await.unwrap();
        pool.close().await;
        assert!(first.is_ok());
        assert!(failed.is_err());
        assert_eq!(cursor, 1);
        assert_eq!(visible, vec!["Last complete cache"]);
    });
}
