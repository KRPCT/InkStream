//! Zotero Web API 增量同步 + 本地 SQLite 离线缓存（Phase 8 ZOT-02）。
//!
//! API Key + userID 存 OS 凭据库（keyring，绝不回传前端，零信任）；增量同步按 library version
//! （`Last-Modified-Version` 头）拉 `format=csljson` 落地全局 SQLite 缓存。Zotero 离线时
//! Sidebar 文献库 / 参考文献展开可回退读缓存（zotero_cache_*）。缓存按 citekey（CSL `citation-key`
//! 或 BBT `citekey`）索引——故离线 `[@key]` 解析依赖条目已设原生 Citation Key（Zotero 6.0.27+）。

use crate::zotero::{to_zotero_item, ZoteroItem};
use keyring_core::Entry;
use serde::Serialize;
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::sync::Once;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const SERVICE: &str = "inkstream";
const USER: &str = "zotero-credentials";
const API_BASE: &str = "https://api.zotero.org";
const PAGE: usize = 100;
const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS zotero_items (\
  zkey TEXT PRIMARY KEY, citekey TEXT NOT NULL DEFAULT '', version INTEGER, csl TEXT NOT NULL);\
  CREATE INDEX IF NOT EXISTS idx_zotero_citekey ON zotero_items(citekey);\
  CREATE TABLE IF NOT EXISTS zotero_meta (k TEXT PRIMARY KEY, v TEXT);";

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

/// 保存 Zotero API Key + userID 到 OS 凭据库（单条 JSON 条目）。
#[tauri::command]
pub async fn zotero_set_credentials(api_key: String, user_id: String) -> Result<(), String> {
    let api_key = api_key.trim().to_string();
    let user_id = user_id.trim().to_string();
    if api_key.is_empty() || user_id.is_empty() {
        return Err("API Key 与 userID 均不能为空".into());
    }
    let json = serde_json::to_string(&Creds { api_key, user_id }).map_err(|e| e.to_string())?;
    entry()?
        .set_password(&json)
        .map_err(|e| format!("保存凭据失败: {e}"))
}

/// 清除已存的 Zotero 凭据。
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

/// 凭据状态（是否已配置 + userID）。API Key 本身绝不回传。
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

async fn open_cache(app: &AppHandle) -> Result<SqlitePool, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法解析应用数据目录: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录: {e}"))?;
    let opts = SqliteConnectOptions::new()
        .filename(dir.join("zotero-cache.db"))
        .create_if_missing(true)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map_err(|e| format!("无法打开缓存库: {e}"))?;
    sqlx::raw_sql(SCHEMA)
        .execute(&pool)
        .await
        .map_err(|e| format!("建表失败: {e}"))?;
    Ok(pool)
}

async fn get_version(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar::<_, String>("SELECT v FROM zotero_meta WHERE k='library_version'")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

async fn upsert_item(pool: &SqlitePool, it: &Value, ver: i64) -> Result<bool, String> {
    let zkey = it.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if zkey.is_empty() {
        return Ok(false);
    }
    let citekey = crate::zotero::item_citekey(it);
    let csl = serde_json::to_string(it).map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO zotero_items(zkey,citekey,version,csl) VALUES(?,?,?,?) \
         ON CONFLICT(zkey) DO UPDATE SET citekey=excluded.citekey, version=excluded.version, csl=excluded.csl",
    )
    .bind(zkey)
    .bind(citekey)
    .bind(ver)
    .bind(csl)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(true)
}

fn header_i64(resp: &reqwest::Response, name: &str) -> Option<i64> {
    resp.headers()
        .get(name)
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse().ok())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroSyncResult {
    pub synced: i64,
    pub removed: i64,
    pub version: i64,
}

/// 增量同步：自上次 library version 起拉取改动条目（分页）+ 删除增量，落地缓存。
/// 首次（version=0）拉全库。403=Key 无效、404=userID 不存在、连接失败=离线，均友好报错。
#[tauri::command]
pub async fn zotero_sync(app: AppHandle) -> Result<ZoteroSyncResult, String> {
    let creds = read_creds().ok_or("尚未配置 Zotero API Key（请在设置中填写）")?;
    let pool = open_cache(&app).await?;
    let since = get_version(&pool).await;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("初始化请求失败: {e}"))?;
    let mut start = 0usize;
    let mut total = usize::MAX;
    let mut synced = 0i64;
    let mut new_ver = since;
    while start < total {
        let url = format!(
            "{API_BASE}/users/{}/items?format=csljson&since={since}&start={start}&limit={PAGE}",
            creds.user_id
        );
        let resp = client
            .get(&url)
            .header("Zotero-API-Key", &creds.api_key)
            .header("Zotero-API-Version", "3")
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() {
                    "无法连接 Zotero 服务器（离线？）".to_string()
                } else if e.is_timeout() {
                    "Zotero 服务器响应超时".to_string()
                } else {
                    format!("同步请求失败: {e}")
                }
            })?;
        let status = resp.status();
        if status.as_u16() == 403 {
            return Err("API Key 无效或无访问权限（403）".into());
        }
        if status.as_u16() == 404 {
            return Err("userID 不存在（404）".into());
        }
        if !status.is_success() {
            return Err(format!("Zotero 服务器错误: {status}"));
        }
        if let Some(t) = header_i64(&resp, "Total-Results") {
            total = t.max(0) as usize;
        }
        if let Some(v) = header_i64(&resp, "Last-Modified-Version") {
            new_ver = v;
        }
        let body: Value = resp.json().await.map_err(|e| format!("解析响应失败: {e}"))?;
        let items = body
            .get("items")
            .and_then(|i| i.as_array())
            .cloned()
            .or_else(|| body.as_array().cloned())
            .unwrap_or_default();
        if items.is_empty() {
            break;
        }
        for it in &items {
            if upsert_item(&pool, it, new_ver).await? {
                synced += 1;
            }
        }
        start += PAGE;
    }
    let removed = sync_deleted(&client, &creds, &pool, since).await.unwrap_or(0);
    sqlx::query(
        "INSERT INTO zotero_meta(k,v) VALUES('library_version',?) \
         ON CONFLICT(k) DO UPDATE SET v=excluded.v",
    )
    .bind(new_ver.to_string())
    .execute(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(ZoteroSyncResult {
        synced,
        removed,
        version: new_ver,
    })
}

async fn sync_deleted(
    client: &reqwest::Client,
    creds: &Creds,
    pool: &SqlitePool,
    since: i64,
) -> Result<i64, String> {
    let url = format!("{API_BASE}/users/{}/deleted?since={since}", creds.user_id);
    let resp = client
        .get(&url)
        .header("Zotero-API-Key", &creds.api_key)
        .header("Zotero-API-Version", "3")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Ok(0);
    }
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    let keys = body
        .get("items")
        .and_then(|i| i.as_array())
        .cloned()
        .unwrap_or_default();
    let mut removed = 0i64;
    for k in keys.iter().filter_map(|k| k.as_str()) {
        sqlx::query("DELETE FROM zotero_items WHERE zkey=?")
            .bind(k)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        removed += 1;
    }
    Ok(removed)
}

/// 离线读缓存：Sidebar 文献库（仅含已设 citekey 的可引用条目）。
#[tauri::command]
pub async fn zotero_cache_items(app: AppHandle) -> Result<Vec<ZoteroItem>, String> {
    let pool = open_cache(&app).await?;
    let rows = sqlx::query_scalar::<_, String>("SELECT csl FROM zotero_items WHERE citekey<>''")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("读取缓存失败: {e}"))?;
    Ok(rows
        .iter()
        .filter_map(|csl| serde_json::from_str::<Value>(csl).ok())
        .filter_map(|v| to_zotero_item(&v))
        .collect())
}

/// 离线读缓存：指定 citekey 的完整 CSL-JSON（参考文献展开回退）。按入参顺序返回，缺失跳过。
#[tauri::command]
pub async fn zotero_cache_csl(app: AppHandle, keys: Vec<String>) -> Result<Vec<Value>, String> {
    let pool = open_cache(&app).await?;
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT citekey, csl FROM zotero_items WHERE citekey<>''",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("读取缓存失败: {e}"))?;
    let mut by_key: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    for (ck, csl) in rows {
        if let Ok(v) = serde_json::from_str::<Value>(&csl) {
            by_key.entry(ck).or_insert(v);
        }
    }
    Ok(keys
        .iter()
        .filter_map(|k| by_key.get(k).cloned())
        .collect())
}
