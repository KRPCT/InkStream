//! GitHub REST 集成（GIT-07 / Phase 11 GH-02/03）：PR 列表/新建/合并/diff/review、Issue 列表/新建、
//! issue 与 PR 共用评论——全走 **GitHub REST API（Rust reqwest）**。文件名沿用 pr.rs（历史），实为 GitHub REST 模块。
//!
//! 安全：token 取自 keyring（auth::github_token），**绝不下发前端**——app 渲染用户 markdown 有 XSS 面，
//! 令牌进 webview JS 即暴露。reqwest 在 Rust 侧直连 api.github.com，同 Zotero 范式（绕 CORS + 令牌不出 Rust）。
//!
//! owner/repo 由 origin 远程 URL 解析（支持 https / scp-like ssh / ssh:// 三式）。host=github.com→api.github.com，
//! 其余 host→`https://<host>/api/v3`（GitHub Enterprise 约定，顺带支持「自定义服务器」）。
//! HTTP 异步（commands 直接 async，无需 spawn_blocking——纯网络不占阻塞线程）。

use super::types::{DiffHunk, DiffLine, FileDiff};
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

// ============================== Issue（GH-02）==============================

/// 前端 Issue DTO（camelCase）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub author: String,
    pub created_at: String,
    pub updated_at: String,
    pub url: String,
    pub comments: u64,
}

/// 仅探测 issues 响应里 `pull_request` 字段是否存在（存在 = 该条其实是 PR，list 时滤掉）。
#[derive(Deserialize)]
struct GhPrMarker {}

#[derive(Deserialize)]
struct GhIssue {
    number: u64,
    title: String,
    state: String,
    #[serde(default)]
    body: Option<String>,
    user: GhUser,
    created_at: String,
    updated_at: String,
    html_url: String,
    comments: u64,
    #[serde(default)]
    pull_request: Option<GhPrMarker>,
}

impl From<GhIssue> for Issue {
    fn from(i: GhIssue) -> Self {
        Issue {
            number: i.number,
            title: i.title,
            body: i.body.unwrap_or_default(),
            state: i.state,
            author: i.user.login,
            created_at: i.created_at,
            updated_at: i.updated_at,
            url: i.html_url,
            comments: i.comments,
        }
    }
}

/// 列出仓库 Issue（state ∈ open|closed|all，按更新倒序最多 50；滤掉混入的 PR）。
#[tauri::command]
pub async fn gh_issue_list(repo_root: String, state: String) -> Result<Vec<Issue>, String> {
    let s = match state.as_str() {
        "open" | "closed" | "all" => state.as_str(),
        _ => "open",
    };
    let (api, owner, repo) = repo_target(&repo_root)?;
    let tok = token()?;
    let url = format!(
        "{api}/repos/{owner}/{repo}/issues?state={s}&sort=updated&direction=desc&per_page=50"
    );
    let resp = with_headers(client().get(&url), &tok)
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;
    let raw: Vec<GhIssue> = read(resp).await?;
    Ok(raw
        .into_iter()
        .filter(|i| i.pull_request.is_none())
        .map(Issue::from)
        .collect())
}

/// 新建 Issue。
#[tauri::command]
pub async fn gh_issue_create(
    repo_root: String,
    title: String,
    body: String,
) -> Result<Issue, String> {
    if title.trim().is_empty() {
        return Err("Issue 标题不能为空".into());
    }
    let (api, owner, repo) = repo_target(&repo_root)?;
    let tok = token()?;
    let url = format!("{api}/repos/{owner}/{repo}/issues");
    let payload = serde_json::json!({ "title": title, "body": body });
    let resp = with_headers(client().post(&url), &tok)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;
    let raw: GhIssue = read(resp).await?;
    Ok(raw.into())
}

// ============================== 评论（issue 与 PR 共用 /issues/{n}/comments）==============================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: u64,
    pub author: String,
    pub body: String,
    pub created_at: String,
    pub url: String,
}

#[derive(Deserialize)]
struct GhComment {
    id: u64,
    #[serde(default)]
    body: Option<String>,
    user: GhUser,
    created_at: String,
    html_url: String,
}

impl From<GhComment> for Comment {
    fn from(c: GhComment) -> Self {
        Comment {
            id: c.id,
            author: c.user.login,
            body: c.body.unwrap_or_default(),
            created_at: c.created_at,
            url: c.html_url,
        }
    }
}

/// 列出 issue/PR 的评论（PR number 即 issue number）。
#[tauri::command]
pub async fn gh_comment_list(repo_root: String, number: u64) -> Result<Vec<Comment>, String> {
    let (api, owner, repo) = repo_target(&repo_root)?;
    let tok = token()?;
    let url = format!("{api}/repos/{owner}/{repo}/issues/{number}/comments?per_page=100");
    let resp = with_headers(client().get(&url), &tok)
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;
    let raw: Vec<GhComment> = read(resp).await?;
    Ok(raw.into_iter().map(Comment::from).collect())
}

/// 给 issue/PR 发表评论。
#[tauri::command]
pub async fn gh_comment_create(
    repo_root: String,
    number: u64,
    body: String,
) -> Result<Comment, String> {
    if body.trim().is_empty() {
        return Err("评论内容不能为空".into());
    }
    let (api, owner, repo) = repo_target(&repo_root)?;
    let tok = token()?;
    let url = format!("{api}/repos/{owner}/{repo}/issues/{number}/comments");
    let payload = serde_json::json!({ "body": body });
    let resp = with_headers(client().post(&url), &tok)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;
    let raw: GhComment = read(resp).await?;
    Ok(raw.into())
}

// ============================== PR diff（/pulls/{n}/files → FileDiff[]，GH-03）==============================

#[derive(Deserialize)]
struct GhPrFile {
    filename: String,
    status: String,
    #[serde(default)]
    patch: Option<String>,
    #[serde(default)]
    previous_filename: Option<String>,
}

/// GitHub 文件 status → FileDiff.status（removed→deleted、changed→modified 归一）。
fn map_file_status(s: &str) -> String {
    match s {
        "added" => "added",
        "removed" => "deleted",
        "renamed" => "renamed",
        "copied" => "copied",
        _ => "modified",
    }
    .to_string()
}

/// 解析 unified diff hunk 头 `@@ -a,b +c,d @@` → (old_start, new_start)。
fn parse_hunk_header(line: &str) -> (u32, u32) {
    let mut old_start = 0u32;
    let mut new_start = 0u32;
    for tok in line.trim_start_matches('@').split_whitespace() {
        if let Some(rest) = tok.strip_prefix('-') {
            old_start = rest.split(',').next().and_then(|n| n.parse().ok()).unwrap_or(0);
        } else if let Some(rest) = tok.strip_prefix('+') {
            new_start = rest.split(',').next().and_then(|n| n.parse().ok()).unwrap_or(0);
        }
    }
    (old_start, new_start)
}

/// GitHub `patch`（不含文件头的 unified diff）→ 结构化 hunk（复用前端 DiffHunkView）。
fn parse_patch(patch: &str) -> Vec<DiffHunk> {
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut old_no = 0u32;
    let mut new_no = 0u32;
    for line in patch.split('\n') {
        if line.starts_with("@@") {
            let (o, n) = parse_hunk_header(line);
            old_no = o;
            new_no = n;
            hunks.push(DiffHunk {
                header: line.to_string(),
                lines: Vec::new(),
            });
            continue;
        }
        let Some(h) = hunks.last_mut() else {
            continue;
        };
        let mut chars = line.chars();
        match chars.next() {
            Some('+') => {
                h.lines.push(DiffLine {
                    origin: '+',
                    old_lineno: None,
                    new_lineno: Some(new_no),
                    content: chars.as_str().to_string(),
                });
                new_no += 1;
            }
            Some('-') => {
                h.lines.push(DiffLine {
                    origin: '-',
                    old_lineno: Some(old_no),
                    new_lineno: None,
                    content: chars.as_str().to_string(),
                });
                old_no += 1;
            }
            Some('\\') => {} // "\ No newline at end of file"
            Some(' ') => {
                h.lines.push(DiffLine {
                    origin: ' ',
                    old_lineno: Some(old_no),
                    new_lineno: Some(new_no),
                    content: chars.as_str().to_string(),
                });
                old_no += 1;
                new_no += 1;
            }
            // 空字符串行（split('\n') 尾随产物 / 空体）非 diff 行，未知前缀亦忽略——均不推进行号。
            None => {}
            Some(_) => {}
        }
    }
    hunks
}

/// 取 PR 的逐文件结构化 diff（最多 100 文件；二进制/超大无 patch 文件 hunks 空）。
#[tauri::command]
pub async fn gh_pr_diff(repo_root: String, number: u64) -> Result<Vec<FileDiff>, String> {
    let (api, owner, repo) = repo_target(&repo_root)?;
    let tok = token()?;
    let url = format!("{api}/repos/{owner}/{repo}/pulls/{number}/files?per_page=100");
    let resp = with_headers(client().get(&url), &tok)
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;
    let files: Vec<GhPrFile> = read(resp).await?;
    Ok(files
        .into_iter()
        .map(|f| {
            let status = map_file_status(&f.status);
            // 纯重命名/纯模式变更也无 patch，但不是二进制（与 diff.rs 一致，避免误标）。
            let binary = f.patch.is_none() && status != "renamed";
            let hunks = f.patch.as_deref().map(parse_patch).unwrap_or_default();
            let (old_path, new_path) = match status.as_str() {
                "added" => (None, Some(f.filename.clone())),
                "deleted" => (Some(f.filename.clone()), None),
                "renamed" => (
                    f.previous_filename.clone().or_else(|| Some(f.filename.clone())),
                    Some(f.filename.clone()),
                ),
                _ => (Some(f.filename.clone()), Some(f.filename.clone())),
            };
            FileDiff {
                old_path,
                new_path,
                status,
                binary,
                hunks,
            }
        })
        .collect())
}

// ============================== PR Review（GH-03）==============================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    pub id: u64,
    pub author: String,
    pub body: String,
    /// APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING。
    pub state: String,
    pub url: String,
    pub submitted_at: Option<String>,
}

#[derive(Deserialize)]
struct GhReview {
    id: u64,
    #[serde(default)]
    user: Option<GhUser>,
    #[serde(default)]
    body: Option<String>,
    state: String,
    html_url: String,
    #[serde(default)]
    submitted_at: Option<String>,
}

impl From<GhReview> for Review {
    fn from(r: GhReview) -> Self {
        Review {
            id: r.id,
            author: r.user.map(|u| u.login).unwrap_or_default(),
            body: r.body.unwrap_or_default(),
            state: r.state,
            url: r.html_url,
            submitted_at: r.submitted_at,
        }
    }
}

/// 列出 PR 的 review（按时间，最多 100）。
#[tauri::command]
pub async fn gh_pr_reviews(repo_root: String, number: u64) -> Result<Vec<Review>, String> {
    let (api, owner, repo) = repo_target(&repo_root)?;
    let tok = token()?;
    let url = format!("{api}/repos/{owner}/{repo}/pulls/{number}/reviews?per_page=100");
    let resp = with_headers(client().get(&url), &tok)
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;
    let raw: Vec<GhReview> = read(resp).await?;
    Ok(raw.into_iter().map(Review::from).collect())
}

/// 提交 PR review。event ∈ {APPROVE, REQUEST_CHANGES, COMMENT}；后两者 body 必填。
#[tauri::command]
pub async fn gh_pr_review_create(
    repo_root: String,
    number: u64,
    event: String,
    body: String,
) -> Result<Review, String> {
    let ev = match event.as_str() {
        "APPROVE" | "REQUEST_CHANGES" | "COMMENT" => event.as_str(),
        _ => return Err(format!("不支持的 review 类型：{event}")),
    };
    if (ev == "REQUEST_CHANGES" || ev == "COMMENT") && body.trim().is_empty() {
        return Err("该 review 类型需要填写评论内容".into());
    }
    let (api, owner, repo) = repo_target(&repo_root)?;
    let tok = token()?;
    let url = format!("{api}/repos/{owner}/{repo}/pulls/{number}/reviews");
    let payload = serde_json::json!({ "event": ev, "body": body });
    let resp = with_headers(client().post(&url), &tok)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("连接 GitHub 失败: {e}"))?;
    let raw: GhReview = read(resp).await?;
    Ok(raw.into())
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

    #[test]
    fn parses_hunk_header_and_status() {
        assert_eq!(parse_hunk_header("@@ -10,5 +12,6 @@ fn x()"), (10, 12));
        assert_eq!(parse_hunk_header("@@ -0,0 +1,3 @@"), (0, 1));
        assert_eq!(map_file_status("removed"), "deleted");
        assert_eq!(map_file_status("changed"), "modified");
        assert_eq!(map_file_status("added"), "added");
    }

    #[test]
    fn parses_patch_lineno_and_origin() {
        let patch = "@@ -1,3 +1,4 @@\n ctx\n-old line\n+new line\n+added\n ctx2";
        let hunks = parse_patch(patch);
        assert_eq!(hunks.len(), 1);
        let l = &hunks[0].lines;
        assert_eq!(l.len(), 5);
        assert_eq!((l[0].origin, l[0].old_lineno, l[0].new_lineno), (' ', Some(1), Some(1)));
        assert_eq!((l[1].origin, l[1].old_lineno, l[1].new_lineno), ('-', Some(2), None));
        assert_eq!((l[2].origin, l[2].old_lineno, l[2].new_lineno), ('+', None, Some(2)));
        assert_eq!((l[3].origin, l[3].old_lineno, l[3].new_lineno), ('+', None, Some(3)));
        assert_eq!((l[4].origin, l[4].old_lineno, l[4].new_lineno), (' ', Some(3), Some(4)));
        assert_eq!(l[1].content, "old line");
    }

    #[test]
    fn parse_patch_ignores_trailing_empty_line() {
        // split('\n') 对带尾随换行的 patch 产出末尾空串——不得当作幻影上下文行。
        let hunks = parse_patch("@@ -1,1 +1,1 @@\n-a\n+b\n");
        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].lines.len(), 2);
    }
}
