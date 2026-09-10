//! Zotero Web API 同步入口。凭据留在 OS 凭据库；缓存按官方用户库隔离。
//! 更新、删除与游标只有在同一远端版本完整下载后才一起提交。

use crate::zotero::{to_zotero_item, ZoteroItem};
use keyring_core::Entry;
use serde::Serialize;
use serde_json::Value;
use sqlx::sqlite::SqlitePool;
use std::sync::Once;
use std::time::Duration;
use tauri::{AppHandle, Manager};

mod cache;
mod download;
#[cfg(test)]
use cache::SCHEMA;
use cache::{cached_csl, get_version, open_cache_at, CommitError};
#[cfg(test)]
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

const SERVICE: &str = "inkstream";
const USER: &str = "zotero-credentials";
const API_BASE: &str = "https://api.zotero.org";
const PAGE: usize = 100;
const MAX_SYNC_ATTEMPTS: usize = 3;

static INIT: Once = Once::new();
fn entry() -> Result<Entry, String> {
    INIT.call_once(|| {
        let _ = keyring::use_native_store(false);
    });
    Entry::new(SERVICE, USER).map_err(|e| format!("打开凭据库失败: {e}"))
}

#[derive(serde::Deserialize, Serialize)]
struct Creds {
    #[serde(rename = "apiKey")]
    api_key: String,
    #[serde(rename = "userId")]
    user_id: String,
}

fn read_creds() -> Option<Creds> {
    let raw = entry().ok()?.get_password().ok()?;
    serde_json::from_str::<Creds>(&raw)
        .ok()
        .filter(|c| !c.api_key.trim().is_empty() && !c.user_id.trim().is_empty())
}

#[tauri::command]
pub async fn zotero_set_credentials(api_key: String, user_id: String) -> Result<(), String> {
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("API Key 不能为空".into());
    }
    let user_id = cache::canonical_user_id(&user_id)?;
    let json = serde_json::to_string(&Creds { api_key, user_id }).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&json)
        .map_err(|e| format!("保存凭据失败: {e}"))
}

#[tauri::command]
pub async fn zotero_clear_credentials() -> Result<(), String> {
    let _ = entry()?.delete_credential();
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroCredStatus {
    pub has_key: bool,
    pub user_id: String,
}

#[tauri::command]
pub async fn zotero_credentials_status() -> Result<ZoteroCredStatus, String> {
    Ok(match read_creds() {
        Some(c) => ZoteroCredStatus {
            has_key: true,
            user_id: c.user_id,
        },
        None => ZoteroCredStatus {
            has_key: false,
            user_id: String::new(),
        },
    })
}

async fn open_cache(app: &AppHandle, user_id: &str) -> Result<SqlitePool, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    open_cache_at(&dir, user_id).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroSyncResult {
    pub synced: i64,
    pub removed: i64,
    pub version: i64,
}

struct Snapshot {
    version: i64,
    items: Vec<CachedItem>,
    deleted: Vec<String>,
}

struct CachedItem {
    key: String,
    csl: Value,
}

#[tauri::command]
pub async fn zotero_sync(app: AppHandle) -> Result<ZoteroSyncResult, String> {
    let mut creds = read_creds().ok_or("尚未配置 Zotero API Key（请在设置中填写）")?;
    creds.user_id = cache::canonical_user_id(&creds.user_id)?;
    let pool = open_cache(&app, &creds.user_id).await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("初始化请求失败: {e}"))?;
    let result = sync_library(&client, &creds, &pool, API_BASE).await;
    pool.close().await;
    result
}

/// 公开同步命令与行为测试使用同一缓存/HTTP seam；测试只替换端点与缓存目录。
async fn sync_library(
    client: &reqwest::Client,
    creds: &Creds,
    pool: &SqlitePool,
    api_base: &str,
) -> Result<ZoteroSyncResult, String> {
    // Zotero 协议要求每个响应库版本相同，变化时重启；失败绝不推进游标。
    // https://www.zotero.org/support/dev/web_api/v3/syncing#iii_check_for_concurrent_remote_updates
    for attempt in 0..MAX_SYNC_ATTEMPTS {
        let since = get_version(pool).await?;
        match download::snapshot(client, creds, since, api_base).await {
            Ok(snapshot) => match cache::commit_snapshot(pool, since, snapshot).await {
                Ok(result) => return Ok(result),
                Err(CommitError::Failed(message)) => return Err(message),
                Err(CommitError::Changed) => {} // 同库另一同步已提交，重新读取新游标。
            },
            Err(download::DownloadError::Failed(message)) => return Err(message),
            Err(download::DownloadError::Changed) => {}
        }
        if attempt + 1 < MAX_SYNC_ATTEMPTS {
            tokio::time::sleep(Duration::from_millis(250 * (attempt as u64 + 1))).await;
        }
    }
    Err("文献库在同步期间持续变化，已停止本次同步；原缓存与游标保持不变，请稍后重试。".into())
}

#[tauri::command]
pub async fn zotero_cache_items(app: AppHandle) -> Result<Vec<ZoteroItem>, String> {
    let creds = read_creds().ok_or("请先配置 Zotero 账户，再读取该账户的离线缓存。")?;
    let pool = open_cache(&app, &creds.user_id).await?;
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT csl FROM zotero_items WHERE citekey<>'' ORDER BY zkey",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("读取缓存失败: {e}"));
    pool.close().await;
    Ok(rows?
        .iter()
        .filter_map(|csl| serde_json::from_str::<Value>(csl).ok())
        .filter_map(|value| to_zotero_item(&value))
        .collect())
}

#[tauri::command]
pub async fn zotero_cache_csl(app: AppHandle, keys: Vec<String>) -> Result<Vec<Value>, String> {
    let creds = read_creds().ok_or("请先配置 Zotero 账户，再读取该账户的离线缓存。")?;
    let pool = open_cache(&app, &creds.user_id).await?;
    let result = cached_csl(&pool, keys).await;
    pool.close().await;
    result
}

#[cfg(test)]
#[path = "zotero_sync/tests.rs"]
mod tests;
