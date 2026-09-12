//! GitHub authentication. Tokens and device codes stay in Rust and the OS keyring.
//! Device Flow, PAT and gh CLI share one credential revision and one atomic entry.

mod core;
mod credentials;
mod http;
#[cfg(test)]
mod tests;

use core::{AuthManager, MonotonicClock};
use credentials::CredentialStore;
use http::GithubHttp;
use keyring_core::{Entry, Error as KeyringError};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{atomic::AtomicBool, Arc, Once, OnceLock};
use std::time::Duration;

const SERVICE: &str = "inkstream";
const USER: &str = "github-token";
static INIT: Once = Once::new();
static MANAGER: OnceLock<Result<Arc<AuthManager>, String>> = OnceLock::new();

struct NativeStore;
fn entry() -> Result<Entry, String> {
    INIT.call_once(|| { let _ = keyring::use_native_store(false); });
    Entry::new(SERVICE, USER).map_err(|_| "无法打开系统 GitHub 凭据库。".into())
}
impl CredentialStore for NativeStore {
    fn read(&self) -> Result<Option<String>, String> {
        match entry()?.get_password() {
            Ok(value) if value.trim().is_empty() => Ok(None),
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err("无法读取系统 GitHub 凭据库。".into()),
        }
    }
    fn write(&self, value: &str) -> Result<(), String> {
        entry()?.set_password(value).map_err(|_| "无法保存 GitHub 凭据，请检查系统凭据库权限。".into())
    }
    fn delete(&self) -> Result<(), String> {
        match entry()?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err("无法删除 GitHub 凭据，请检查系统凭据库权限。".into()),
        }
    }
}
fn manager() -> Result<Arc<AuthManager>, String> {
    MANAGER.get_or_init(|| Ok(AuthManager::new(Arc::new(NativeStore), GithubHttp::production()?, Arc::new(MonotonicClock::new())))).clone()
}

/// All GitHub REST and admitted HTTPS Git callers receive only a usable credential.
pub async fn github_token() -> Result<Option<String>, String> { manager()?.token().await }

#[tauri::command]
pub async fn git_login_github(token: String) -> Result<(), String> { manager()?.save_pat(token).await }
#[tauri::command]
pub async fn git_logout_github() -> Result<(), String> { manager()?.logout().await }
#[tauri::command]
pub async fn git_github_status() -> Result<bool, String> { Ok(github_token().await?.is_some()) }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceConfiguration { client_id: Option<String> }
#[tauri::command]
pub fn git_github_device_configuration() -> DeviceConfiguration {
    // An OAuth App's public ID is distributable; no client secret belongs in a desktop app.
    DeviceConfiguration { client_id: option_env!("INKSTREAM_GITHUB_CLIENT_ID")
        .map(str::trim).filter(|value| !value.is_empty()).map(str::to_owned) }
}
#[tauri::command]
pub async fn git_github_device_start(window: tauri::WebviewWindow, request_id: String, client_id: Option<String>) -> Result<core::DeviceStart, String> {
    let _ = window.is_visible().map_err(|_| "发起登录的窗口已关闭。".to_string())?;
    let client_id = client_id.filter(|value| !value.trim().is_empty())
        .or_else(|| git_github_device_configuration().client_id)
        .ok_or("尚未配置 GitHub OAuth App Client ID；请填写自己的 App ID 并启用 Device Flow。")?;
    manager()?.start(window.label(), &request_id, &client_id).await
}
#[tauri::command]
pub async fn git_github_device_poll(window: tauri::WebviewWindow, request_id: String) -> Result<core::DevicePoll, String> {
    manager()?.poll(window.label(), &request_id).await
}
#[tauri::command]
pub fn git_github_device_cancel(window: tauri::WebviewWindow, request_id: String) -> Result<bool, String> {
    Ok(manager()?.cancel(window.label(), &request_id))
}
pub fn close_owner(owner: &str) {
    if let Some(Ok(manager)) = MANAGER.get() { manager.close_owner(owner); }
}

fn gh_program() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).filter(|directory| directory.is_absolute())
        .map(|directory| directory.join(if cfg!(windows) { "gh.exe" } else { "gh" }))
        .find(|candidate| candidate.is_file())
}
/// Capture stdout privately with a hard deadline and an owned process tree.
fn gh_token_from_cli() -> Result<String, String> {
    let program = gh_program().ok_or("未检测到 gh CLI；请安装 GitHub CLI，或使用浏览器/PAT 登录。")?;
    let output = super::rebase_process::run_process(&super::rebase_process::ProcessSpec {
        program, cwd: std::env::temp_dir(),
        args: ["auth", "token", "--hostname", "github.com"].into_iter().map(Into::into).collect(),
        env_remove: ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "INKSTREAM_GH_TOKEN"]
            .into_iter().map(Into::into).collect(),
        env_set: vec![("GH_PROMPT_DISABLED".into(), "1".into()), ("GH_HOST".into(), "github.com".into())],
    }, &AtomicBool::new(false), Duration::from_secs(15))
        .map_err(|_| "无法调用 gh CLI，请检查安装。".to_string())?;
    if output.interruption.is_some() || output.cleanup_error.is_some() { return Err("gh CLI 登录状态读取超时或未完成，请在终端检查后重试。".into()); }
    if output.exit_code != Some(0) { return Err("gh 尚未在 github.com 登录；请先运行 gh auth login，或使用浏览器/PAT 登录。".into()); }
    let token = output.stdout.trim();
    if !credentials::valid_secret(token) { return Err("gh 未返回有效的 GitHub 凭据。".into()); }
    Ok(token.to_owned())
}
#[tauri::command]
pub async fn gh_cli_status() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| gh_token_from_cli().is_ok()).await
        .map_err(|_| "无法调度 gh CLI 状态检查。".into())
}
#[tauri::command]
pub async fn git_login_github_gh() -> Result<(), String> {
    let manager = manager()?;
    let ticket = manager.begin_change()?;
    let result = tauri::async_runtime::spawn_blocking(gh_token_from_cli).await
        .map_err(|_| "无法调度 gh CLI 登录。".to_string()).and_then(|value| value);
    match result {
        Ok(token) => manager.save_pat_at(ticket, token).await,
        Err(error) => { manager.abort_change(&ticket); Err(error) }
    }
}
