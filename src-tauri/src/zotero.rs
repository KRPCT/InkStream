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
