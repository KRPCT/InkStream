//! GitHub 登录（簇④）：Personal Access Token 存 OS 凭据库（keyring）。
//!
//! 为何 PAT 而非 OAuth Device Flow：后者需注册 GitHub OAuth App 的 client_id（本项目暂无），PAT 是 git
//! 客户端通行做法、立即可用。token 仅存 keyring（InkStream 专用条目，**不写 git 的 GCM/github 凭据**，
//! 不污染用户既有 HTTPS 认证）；远程 HTTPS 操作时由 remote.rs 经 env + inline credential helper 临时注入。
//! token 绝不回传前端（前端只查「是否已登录」bool）。

use super::GitError;
use keyring_core::Entry;
use std::sync::Once;

const SERVICE: &str = "inkstream";
const USER: &str = "github-token";

/// keyring 4.0 须先注册默认 store（OS 原生凭据库）才能用 Entry。进程内一次（best-effort，失败则 Entry 操作自报错）。
static INIT: Once = Once::new();
fn ensure_store() {
    INIT.call_once(|| {
        let _ = keyring::use_native_store(false);
    });
}

fn entry() -> Result<Entry, GitError> {
    ensure_store();
    Entry::new(SERVICE, USER).map_err(|e| GitError::Internal(format!("打开凭据库失败: {e}")))
}

/// 读取已存的 GitHub token（供 remote.rs 注入 HTTPS 凭据）。无则 None。
pub fn github_token() -> Option<String> {
    entry()
        .ok()
        .and_then(|e| e.get_password().ok())
        .filter(|t| !t.trim().is_empty())
}

/// 登录：保存 GitHub Personal Access Token 到 OS 凭据库。
#[tauri::command]
pub async fn git_login_github(token: String) -> Result<(), String> {
    super::blocking(move || {
        let token = token.trim();
        if token.is_empty() {
            return Err(GitError::Git("token 不能为空".into()));
        }
        entry()?
            .set_password(token)
            .map_err(|e| GitError::Internal(format!("保存 token 失败: {e}")))?;
        Ok(())
    })
    .await
}

/// 登出：从凭据库删除 GitHub token。
#[tauri::command]
pub async fn git_logout_github() -> Result<(), String> {
    super::blocking(move || {
        let _ = entry()?.delete_credential(); // 不存在也视为成功
        Ok(())
    })
    .await
}

/// 是否已登录（凭据库中存在非空 token）。token 本身绝不回传。
#[tauri::command]
pub async fn git_github_status() -> Result<bool, String> {
    super::blocking(move || Ok(github_token().is_some())).await
}
