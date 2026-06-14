//! Zotero 集成（Phase 8 ZOT-01）：CAYW（Cite As You Write）经 Rust reqwest 代理 Better BibTeX
//! 本地端点（127.0.0.1:23119），绕 webview CORS（同 GitHub PR / 研究既定方案）。
//!
//! CAYW 是**交互式**：请求会打开 Zotero 的引用选择器并阻塞到用户选完，故给长超时（用户可能慢慢挑）。
//! 三态错误（成功标准 ZOT-01）：连接拒绝=Zotero 未运行；404=BBT 未装；超时=选择超时/取消。
//! format=pandoc 直接返回 `[@citekey]`（多选 `[@a; @b]`），前端原样插入光标处。

use serde::Serialize;
use std::time::Duration;

// brackets=true 强制方括号引用式 `[@citekey]`（多选 `[@a; @b]`）；缺省 pandoc 是行内式 `@citekey`（无括号）。
const CAYW_URL: &str = "http://127.0.0.1:23119/better-bibtex/cayw?format=pandoc&brackets=true";
/// 交互式选择，给足时间（用户在 Zotero picker 里挑条目）。
const CAYW_TIMEOUT_SECS: u64 = 120;
const JSONRPC_URL: &str = "http://127.0.0.1:23119/better-bibtex/json-rpc";

#[tauri::command]
pub async fn zotero_cayw() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(CAYW_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("初始化请求失败: {e}"))?;
    let resp = client.get(CAYW_URL).send().await.map_err(|e| {
        if e.is_timeout() {
            "引用选择超时或已取消".to_string()
        } else if e.is_connect() {
            "Zotero 未运行（请先启动 Zotero）".to_string()
        } else {
            format!("连接 Zotero 失败: {e}")
        }
    })?;
    if resp.status().as_u16() == 404 {
        return Err("Zotero 未安装 Better BibTeX 插件（CAYW 端点不存在）".to_string());
    }
    if !resp.status().is_success() {
        return Err(format!("Zotero 返回错误: {}", resp.status()));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取 Zotero 响应失败: {e}"))?;
    Ok(text.trim().to_string())
}

/// BBT JSON-RPC `item.search("")` → 库内全部条目（CSL-JSON Value 数组）。短超时（非交互）。
/// 连接拒绝=未运行、404=BBT 未装、超时分别友好报错。zotero_citekeys / zotero_items 共用。
async fn bbt_search() -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("初始化请求失败: {e}"))?;
    let payload =
        serde_json::json!({ "jsonrpc": "2.0", "method": "item.search", "params": [""], "id": 1 });
    let resp = client
        .post(JSONRPC_URL)
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() {
                "Zotero 未运行（请先启动 Zotero）".to_string()
            } else if e.is_timeout() {
                "Zotero 响应超时".to_string()
            } else {
                format!("连接 Zotero 失败: {e}")
            }
        })?;
    if resp.status().as_u16() == 404 {
        return Err("Zotero 未安装 Better BibTeX 插件".to_string());
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("解析 Zotero 响应失败: {e}"))?;
    Ok(v.get("result")
        .and_then(|r| r.as_array())
        .cloned()
        .unwrap_or_default())
}

/// CSL-JSON 字段名：citekey（BBT）/ citation-key（CSL），都试。
fn item_citekey(it: &serde_json::Value) -> &str {
    it.get("citekey")
        .or_else(|| it.get("citation-key"))
        .and_then(|k| k.as_str())
        .unwrap_or("")
}

/// 取 Zotero 库内全部 citekey（ZOT-03 解析用）。CitationPanel 据此判 `[@key]` 是否未解析。
#[tauri::command]
pub async fn zotero_citekeys() -> Result<Vec<String>, String> {
    let items = bbt_search().await?;
    Ok(items
        .iter()
        .map(item_citekey)
        .filter(|k| !k.is_empty())
        .map(String::from)
        .collect())
}

/// 文献库条目精简视图（ACAD-01 Sidebar 文献库 + 点击插引用）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoteroItem {
    pub citekey: String,
    pub title: String,
    /// 首作者姓（多作者加「等」）。
    pub authors: String,
    pub year: String,
}

/// 取 Zotero 库条目（ACAD-01）：citekey + 标题 + 首作者 + 年（CSL-JSON 解析）。
#[tauri::command]
pub async fn zotero_items() -> Result<Vec<ZoteroItem>, String> {
    let items = bbt_search().await?;
    let mut out = Vec::new();
    for it in &items {
        let citekey = item_citekey(it);
        if citekey.is_empty() {
            continue;
        }
        let title = it.get("title").and_then(|t| t.as_str()).unwrap_or("(无标题)");
        let authors = it
            .get("author")
            .and_then(|a| a.as_array())
            .map(|arr| {
                let first = arr
                    .first()
                    .and_then(|c| {
                        c.get("family")
                            .or_else(|| c.get("literal"))
                            .and_then(|f| f.as_str())
                    })
                    .unwrap_or("");
                if arr.len() > 1 {
                    format!("{first} 等")
                } else {
                    first.to_string()
                }
            })
            .unwrap_or_default();
        let year = it
            .get("issued")
            .and_then(|i| i.get("date-parts"))
            .and_then(|d| d.as_array())
            .and_then(|d| d.first())
            .and_then(|p| p.as_array())
            .and_then(|p| p.first())
            .map(|y| {
                y.as_str()
                    .map(String::from)
                    .or_else(|| y.as_i64().map(|n| n.to_string()))
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        out.push(ZoteroItem {
            citekey: citekey.to_string(),
            title: title.to_string(),
            authors,
            year,
        });
    }
    Ok(out)
}

/// 取指定 citekey 的完整 CSL-JSON 条目（ZOT-04 参考文献按样式展开）。
/// 按入参 keys 顺序返回（引用首现序），库中缺失的键跳过；前端据返回集判未解析。
#[tauri::command]
pub async fn zotero_csl(keys: Vec<String>) -> Result<Vec<serde_json::Value>, String> {
    let items = bbt_search().await?;
    let mut by_key: std::collections::HashMap<&str, &serde_json::Value> =
        std::collections::HashMap::new();
    for it in &items {
        let k = item_citekey(it);
        if !k.is_empty() {
            by_key.entry(k).or_insert(it);
        }
    }
    Ok(keys
        .iter()
        .filter_map(|k| by_key.get(k.as_str()).map(|v| (*v).clone()))
        .collect())
}
