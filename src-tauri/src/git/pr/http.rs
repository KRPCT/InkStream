//! Shared bounded HTTP transport for GitHub REST, including review discussions.
use serde::de::DeserializeOwned;
use std::time::Duration;

pub(super) const RESPONSE_BYTES: usize = 8 * 1024 * 1024;
pub(super) fn client() -> Result<reqwest::Client, String> {
    client_with_timeout(Duration::from_secs(30))
}
pub(super) fn client_with_timeout(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder().connect_timeout(Duration::from_secs(10).min(timeout)).timeout(timeout)
        .redirect(reqwest::redirect::Policy::none()).build().map_err(|error| format!("初始化 GitHub 连接失败: {error}"))
}

pub(super) async fn read<T: DeserializeOwned>(response: reqwest::Response) -> Result<T, String> {
    read_with_limit(response, RESPONSE_BYTES).await
}

pub(super) async fn read_with_limit<T: DeserializeOwned>(mut response: reqwest::Response, maximum: usize) -> Result<T, String> {
    let status = response.status();
    if response.content_length().is_some_and(|length| length > maximum as u64) {
        return Err("GitHub 回复超过读取预算，请在 GitHub 查看。未返回部分结果。".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| format!("读取 GitHub 回复失败: {error}"))? {
        if bytes.len().saturating_add(chunk.len()) > maximum { return Err("GitHub 回复超过读取预算，请在 GitHub 查看。未返回部分结果。".into()); }
        bytes.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        let message = serde_json::from_slice::<serde_json::Value>(&bytes).ok()
            .and_then(|value| value.get("message").and_then(|value| value.as_str()).map(str::to_owned))
            .unwrap_or_else(|| status.to_string());
        return Err(format!("GitHub API 错误（{}）：{message}", status.as_u16()));
    }
    serde_json::from_slice(&bytes).map_err(|error| format!("解析 GitHub 回复失败: {error}"))
}

pub(super) fn checked_reply<T: serde::Serialize>(value: T) -> Result<T, String> {
    // All new paged JSON commands stay below the existing 1MiB IPC contract.
    let bytes = serde_json::to_vec(&value).map_err(|error| error.to_string())?;
    if bytes.len() > 1024 * 1024 { return Err("此页超过显示预算，请在 GitHub 查看。未返回部分结果。".into()); }
    Ok(value)
}
