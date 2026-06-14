//! Zotero 集成（Phase 8 ZOT-01）：CAYW（Cite As You Write）经 Rust reqwest 代理 Better BibTeX
//! 本地端点（127.0.0.1:23119），绕 webview CORS（同 GitHub PR / 研究既定方案）。
//!
//! CAYW 是**交互式**：请求会打开 Zotero 的引用选择器并阻塞到用户选完，故给长超时（用户可能慢慢挑）。
//! 三态错误（成功标准 ZOT-01）：连接拒绝=Zotero 未运行；404=BBT 未装；超时=选择超时/取消。
//! format=pandoc 直接返回 `[@citekey]`（多选 `[@a; @b]`），前端原样插入光标处。

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

/// 取 Zotero 库内全部 citekey（ZOT-03 解析用）：BBT JSON-RPC `item.search("")` → 各条目的 citationKey。
/// CitationPanel 据此判文档 `[@key]` 是否「未解析」（不在此集合即标红）。短超时（非交互）。
#[tauri::command]
pub async fn zotero_citekeys() -> Result<Vec<String>, String> {
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
    let items = v
        .get("result")
        .and_then(|r| r.as_array())
        .ok_or("Zotero 响应缺少 result 数组")?;
    let mut keys = Vec::new();
    for it in items {
        // BBT 字段名跨版本：citationKey（现）/ citekey（旧），都试。
        if let Some(k) = it
            .get("citationKey")
            .or_else(|| it.get("citekey"))
            .and_then(|k| k.as_str())
        {
            if !k.is_empty() {
                keys.push(k.to_string());
            }
        }
    }
    Ok(keys)
}
