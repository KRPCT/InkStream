//! GitHub Pull Request 流程（GIT-07）：列表 / 新建 / 合并，走 **GitHub REST API（Rust reqwest）**。
//!
//! 安全：token 取自 keyring（auth::github_token），**绝不下发前端**——app 渲染用户 markdown 有 XSS 面，
//! 令牌进 webview JS 即暴露。reqwest 在 Rust 侧直连 api.github.com，同 Zotero 范式（绕 CORS + 令牌不出 Rust）。
//!
//! owner/repo 由 origin 远程 URL 解析（支持 https / scp-like ssh / ssh:// 三式）。host=github.com→api.github.com，
//! 其余 host→`https://<host>/api/v3`（GitHub Enterprise 约定，顺带支持「自定义服务器」）。
//! HTTP 异步（commands 直接 async，无需 spawn_blocking——纯网络不占阻塞线程）。

use serde::{Deserialize, Serialize};
use std::process::Command;

const UA: &str = "InkStream";
const API_VERSION: &str = "2022-11-28";

/// 前端用 PR DTO（camelCase）。从 GitHub 响应映射的精简视图。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub draft: bool,
    /// github.com 上的网页地址（用于「在浏览器打开」）。
    pub url: String,
    pub author: String,
    pub head_ref: String,
    pub base_ref: String,
}

/// 合并结果。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub merged: bool,
    pub message: String,
}

// ---- GitHub API 响应（反序列化）----

#[derive(Deserialize)]
struct GhUser {
    login: String,
}

#[derive(Deserialize)]
struct GhRef {
    #[serde(rename = "ref")]
    ref_: String,
}

#[derive(Deserialize)]
struct GhPull {
    number: u64,
    title: String,
    #[serde(default)]
    body: Option<String>,
    state: String,
    #[serde(default)]
    draft: bool,
    html_url: String,
    user: GhUser,
    head: GhRef,
    base: GhRef,
}

impl From<GhPull> for PullRequest {
    fn from(p: GhPull) -> Self {
        PullRequest {
            number: p.number,
            title: p.title,
            body: p.body.unwrap_or_default(),
            state: p.state,
            draft: p.draft,
            url: p.html_url,
            author: p.user.login,
            head_ref: p.head.ref_,
            base_ref: p.base.ref_,
        }
    }
}

#[derive(Deserialize)]
struct GhError {
    message: String,
}

#[derive(Deserialize)]
struct GhMerge {
    merged: bool,
    message: String,
}

// ---- 仓库/远程解析 ----

/// 解析远程 URL → (host, owner, repo)。支持：
/// - `https://github.com/owner/repo(.git)`
/// - `git@github.com:owner/repo(.git)`（scp-like）
/// - `ssh://git@github.com/owner/repo(.git)`
fn parse_remote(url: &str) -> Option<(String, String, String)> {
    let s = url.trim();
    let s = s.strip_suffix(".git").unwrap_or(s);
    // scp-like：git@host:owner/repo
    if let Some(rest) = s.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        let (owner, repo) = path.split_once('/')?;
        return non_empty(host, owner, first_seg(repo));
    }
    // 带 scheme：ssh:// / https:// / http://
    for pre in ["ssh://", "https://", "http://"] {
        if let Some(rest) = s.strip_prefix(pre) {
            // 去掉可能的 user@（ssh://git@host/...）
            let rest = rest.rsplit_once('@').map(|(_, r)| r).unwrap_or(rest);
            let (host, path) = rest.split_once('/')?;
            let host = host.split(':').next().unwrap_or(host); // 去端口
            let (owner, repo) = path.split_once('/')?;
            return non_empty(host, owner, first_seg(repo));
        }
    }
    None
}

/// repo 段可能后跟多余路径，取首段。
fn first_seg(s: &str) -> &str {
    s.split('/').next().unwrap_or(s)
}

fn non_empty(host: &str, owner: &str, repo: &str) -> Option<(String, String, String)> {
    if host.is_empty() || owner.is_empty() || repo.is_empty() {
        return None;
    }
    Some((host.to_string(), owner.to_string(), repo.to_string()))
}

/// API base：github.com→api.github.com；其余→`https://<host>/api/v3`（GHE）。
fn api_base(host: &str) -> String {
    if host == "github.com" || host == "www.github.com" {
        "https://api.github.com".to_string()
    } else {
        format!("https://{host}/api/v3")
    }
}

fn origin_url(repo_root: &str) -> Option<String> {
    Command::new("git")
        .current_dir(repo_root)
        .args(["remote", "get-url", "--", "origin"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// 解析当前仓库的 (api_base, owner, repo)。
fn repo_target(repo_root: &str) -> Result<(String, String, String), String> {
    let url = origin_url(repo_root).ok_or("这个仓库没有配置 origin 远程")?;
    let (host, owner, repo) =
        parse_remote(&url).ok_or_else(|| format!("无法从远程 URL 解析仓库：{url}"))?;
    Ok((api_base(&host), owner, repo))
}

fn token() -> Result<String, String> {
    super::auth::github_token().ok_or("未登录 GitHub：请先在设置里登录".to_string())
}

fn client() -> reqwest::Client {
    reqwest::Client::new()
}

/// 给请求加通用头（认证 / UA / Accept / API 版本）。
fn with_headers(req: reqwest::RequestBuilder, tok: &str) -> reqwest::RequestBuilder {
    req.bearer_auth(tok)
        .header("User-Agent", UA)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
}

/// 解析响应：非 2xx → 提取 GitHub message 友好化；2xx → 反序列化目标类型。
async fn read<T: serde::de::DeserializeOwned>(resp: reqwest::Response) -> Result<T, String> {
    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
    if !status.is_success() {
        let msg = serde_json::from_str::<GhError>(&text)
            .map(|e| e.message)
            .unwrap_or_else(|_| text.clone());
        return Err(format!("GitHub API 错误（{}）：{msg}", status.as_u16()));
    }
    serde_json::from_str::<T>(&text).map_err(|e| format!("解析 GitHub 响应失败: {e}"))
}

// ---- commands ----

/// 列出仓库的开放 PR（按更新时间倒序，最多 50 条）。
#[tauri::command]
pub async fn gh_pr_list(repo_root: String) -> Result<Vec<PullRequest>, String> {
    let (api, owner, repo) = repo_target(&repo_root)?;
    let tok = token()?;
    let url = format!("{api}/repos/{owner}/{repo}/pulls?state=open&sort=updated&direction=desc&per_page=50");
    let resp = with_headers(client().get(&url), &tok)
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;
    let pulls: Vec<GhPull> = read(resp).await?;
    Ok(pulls.into_iter().map(PullRequest::from).collect())
}

/// 新建 PR：head（来源分支，通常当前分支）→ base（目标分支）。
#[tauri::command]
pub async fn gh_pr_create(
    repo_root: String,
    title: String,
    body: String,
    base: String,
    head: String,
) -> Result<PullRequest, String> {
    if title.trim().is_empty() {
        return Err("PR 标题不能为空".into());
    }
    let (api, owner, repo) = repo_target(&repo_root)?;
    let tok = token()?;
    let url = format!("{api}/repos/{owner}/{repo}/pulls");
    let payload = serde_json::json!({ "title": title, "body": body, "base": base, "head": head });
    let resp = with_headers(client().post(&url), &tok)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;
    let pull: GhPull = read(resp).await?;
    Ok(pull.into())
}

/// 合并 PR。method ∈ {merge, squash, rebase}。
#[tauri::command]
pub async fn gh_pr_merge(
    repo_root: String,
    number: u64,
    method: String,
) -> Result<MergeResult, String> {
    let m = match method.as_str() {
        "merge" | "squash" | "rebase" => method.as_str(),
        _ => return Err(format!("不支持的合并方式：{method}")),
    };
    let (api, owner, repo) = repo_target(&repo_root)?;
    let tok = token()?;
    let url = format!("{api}/repos/{owner}/{repo}/pulls/{number}/merge");
    let payload = serde_json::json!({ "merge_method": m });
    let resp = with_headers(client().put(&url), &tok)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;
    let merged: GhMerge = read(resp).await?;
    Ok(MergeResult {
        merged: merged.merged,
        message: merged.message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_https_remote() {
        let r = parse_remote("https://github.com/KRPCT/InkStream.git").unwrap();
        assert_eq!(r, ("github.com".into(), "KRPCT".into(), "InkStream".into()));
    }

    #[test]
    fn parses_https_without_suffix() {
        let r = parse_remote("https://github.com/KRPCT/InkStream").unwrap();
        assert_eq!(r, ("github.com".into(), "KRPCT".into(), "InkStream".into()));
    }

    #[test]
    fn parses_scp_ssh_remote() {
        let r = parse_remote("git@github.com:KRPCT/InkStream.git").unwrap();
        assert_eq!(r, ("github.com".into(), "KRPCT".into(), "InkStream".into()));
    }

    #[test]
    fn parses_ssh_scheme_remote() {
        let r = parse_remote("ssh://git@github.com/KRPCT/InkStream.git").unwrap();
        assert_eq!(r, ("github.com".into(), "KRPCT".into(), "InkStream".into()));
    }

    #[test]
    fn parses_ghe_host_with_port() {
        let r = parse_remote("https://ghe.corp.com:8443/team/proj.git").unwrap();
        assert_eq!(r, ("ghe.corp.com".into(), "team".into(), "proj".into()));
    }

    #[test]
    fn api_base_github_vs_ghe() {
        assert_eq!(api_base("github.com"), "https://api.github.com");
        assert_eq!(api_base("ghe.corp.com"), "https://ghe.corp.com/api/v3");
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_remote("not-a-url").is_none());
        assert!(parse_remote("https://github.com/onlyowner").is_none());
    }
}
