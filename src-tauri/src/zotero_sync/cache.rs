use super::{CachedItem, Snapshot, ZoteroSyncResult};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::{Executor, Sqlite};
use std::path::Path;
use std::time::Duration;

pub(super) const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS zotero_items (\
  zkey TEXT PRIMARY KEY, citekey TEXT NOT NULL DEFAULT '', version INTEGER, csl TEXT NOT NULL);\
  CREATE INDEX IF NOT EXISTS idx_zotero_citekey ON zotero_items(citekey);\
  CREATE TABLE IF NOT EXISTS zotero_meta (k TEXT PRIMARY KEY, v TEXT);";

pub(super) fn canonical_user_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err("userID 必须是 Zotero 账户的正整数 ID".into());
    }
    value
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0)
        .map(|id| id.to_string())
        .ok_or_else(|| "userID 必须是 Zotero 账户的正整数 ID".into())
}

pub(super) async fn open_cache_at(dir: &Path, user_id: &str) -> Result<SqlitePool, String> {
    let user_id = canonical_user_id(user_id)?;
    // v1 的 zotero-cache.db 没有归属元数据，原样留存，绝不猜测它属于当前账户。
    // 本路径只容纳官方 Web API 的 users 库；未来 groups/local API 必须使用不同分区。
    let partition = dir.join("zotero-cache-v2");
    std::fs::create_dir_all(&partition).map_err(|e| format!("无法创建缓存目录: {e}"))?;
    let options = SqliteConnectOptions::new()
        .filename(partition.join(format!("users-{user_id}.db")))
        .create_if_missing(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| format!("无法打开账户缓存: {e}"))?;
    sqlx::raw_sql(SCHEMA)
        .execute(&pool)
        .await
        .map_err(|e| format!("建立缓存表失败: {e}"))?;
    Ok(pool)
}

pub(super) async fn get_version(pool: &SqlitePool) -> Result<i64, String> {
    let value =
        sqlx::query_scalar::<_, String>("SELECT v FROM zotero_meta WHERE k='library_version'")
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("读取同步游标失败: {e}"))?;
    parse_version(value)
}

fn parse_version(value: Option<String>) -> Result<i64, String> {
    match value {
        None => Ok(0),
        Some(value) => value
            .parse::<i64>()
            .ok()
            .filter(|v| *v >= 0)
            .ok_or_else(|| "账户缓存的同步游标无效，未开始同步。".into()),
    }
}

async fn upsert_item<'e, E>(executor: E, item: &CachedItem, version: i64) -> Result<(), String>
where
    E: Executor<'e, Database = Sqlite>,
{
    let citekey = crate::zotero::item_citekey(&item.csl);
    let csl = serde_json::to_string(&item.csl).map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO zotero_items(zkey,citekey,version,csl) VALUES(?,?,?,?) \
        ON CONFLICT(zkey) DO UPDATE SET citekey=excluded.citekey, version=excluded.version, csl=excluded.csl")
        .bind(&item.key).bind(citekey).bind(version).bind(csl).execute(executor).await
        .map_err(|e| format!("写入文献缓存失败: {e}"))?;
    Ok(())
}

pub(super) enum CommitError {
    Changed,
    Failed(String),
}

impl From<sqlx::Error> for CommitError {
    fn from(error: sqlx::Error) -> Self {
        Self::Failed(format!("提交文献缓存失败: {error}"))
    }
}

pub(super) async fn commit_snapshot(
    pool: &SqlitePool,
    since: i64,
    snapshot: Snapshot,
) -> Result<ZoteroSyncResult, CommitError> {
    let mut transaction = pool.begin().await?;
    let current =
        sqlx::query_scalar::<_, String>("SELECT v FROM zotero_meta WHERE k='library_version'")
            .fetch_optional(&mut *transaction)
            .await?;
    if parse_version(current).map_err(CommitError::Failed)? != since {
        return Err(CommitError::Changed);
    }
    for item in &snapshot.items {
        upsert_item(&mut *transaction, item, snapshot.version)
            .await
            .map_err(CommitError::Failed)?;
    }
    let mut removed = 0;
    for key in &snapshot.deleted {
        removed += sqlx::query("DELETE FROM zotero_items WHERE zkey=?")
            .bind(key)
            .execute(&mut *transaction)
            .await?
            .rows_affected() as i64;
    }
    sqlx::query(
        "INSERT INTO zotero_meta(k,v) VALUES('library_version',?) \
        ON CONFLICT(k) DO UPDATE SET v=excluded.v",
    )
    .bind(snapshot.version.to_string())
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;
    Ok(ZoteroSyncResult {
        synced: snapshot.items.len() as i64,
        removed,
        version: snapshot.version,
    })
}

pub(super) async fn cached_csl(pool: &SqlitePool, keys: Vec<String>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT citekey, csl FROM zotero_items WHERE citekey<>'' ORDER BY zkey",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| format!("读取缓存失败: {e}"))?;
    let mut by_key = std::collections::HashMap::new();
    for (key, csl) in rows {
        if let Ok(value) = serde_json::from_str::<Value>(&csl) {
            by_key.entry(key).or_insert(value);
        }
    }
    Ok(keys
        .iter()
        .filter_map(|key| by_key.get(key).cloned())
        .collect())
}
