use super::{http::{checked_reply, client, read}, repo_target, token, with_headers, GhComment, GhIssue, GhPrFile, GhPull, GhReview, Comment, Issue, PullRequest, Review, map_file_status, parse_patch};
use serde::{de::DeserializeOwned, Serialize};
use std::time::Duration;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> { pub items: Vec<T>, pub next_page: Option<u32> }

pub(super) fn legacy_items<T: Serialize>(page: Page<T>) -> Result<Vec<T>, String> {
    if page.next_page.is_some() { return Err("结果有后续页，请使用分页 GitHub 入口。未返回不完整列表。".into()); }
    checked_reply(page.items)
}

async fn page<T: DeserializeOwned>(client: &reqwest::Client, endpoint: &str, credential: &str, number: u32, size: u32) -> Result<Page<T>, String> {
    if number == 0 || number > 10_000 { return Err("GitHub 页码无效。".into()); }
    let separator = if endpoint.contains('?') { '&' } else { '?' };
    let response = with_headers(client.get(format!("{endpoint}{separator}per_page={size}&page={number}")), credential)
        .send().await.map_err(|error| format!("连接 GitHub 失败: {error}"))?;
    // Never follow a Link URL with credentials. Only construct the next numeric page on our endpoint.
    let next = response.headers().get(reqwest::header::LINK).and_then(|header| header.to_str().ok())
        .is_some_and(|value| value.split(',').any(|link| link.split(';').skip(1).any(|parameter| parameter.trim() == "rel=\"next\"")));
    let items = read(response).await?;
    Ok(Page { items, next_page: next.then_some(number + 1) })
}

#[tauri::command]
pub async fn gh_issue_page(repo_root: String, state: String, page_number: u32) -> Result<Page<Issue>, String> {
    let state = match state.as_str() { "open" | "closed" | "all" => state.as_str(), _ => return Err("Issue 筛选无效。".into()) };
    let (api, owner, repo) = repo_target(&repo_root)?;
    let raw: Page<GhIssue> = page(&client()?, &format!("{api}/repos/{owner}/{repo}/issues?state={state}&sort=created&direction=desc"), &token().await?, page_number, 10).await?;
    checked_reply(Page { next_page: raw.next_page, items: raw.items.into_iter().filter(|item| item.pull_request.is_none()).map(Issue::from).collect() })
}

#[tauri::command]
pub async fn gh_pr_page(repo_root: String, page_number: u32) -> Result<Page<PullRequest>, String> {
    let (api, owner, repo) = repo_target(&repo_root)?;
    let raw: Page<GhPull> = page(&client()?, &format!("{api}/repos/{owner}/{repo}/pulls?state=open&sort=created&direction=desc"), &token().await?, page_number, 10).await?;
    checked_reply(Page { next_page: raw.next_page, items: raw.items.into_iter().map(PullRequest::from).collect() })
}

#[tauri::command]
pub async fn gh_comment_page(repo_root: String, number: u64, page_number: u32) -> Result<Page<Comment>, String> {
    if number == 0 { return Err("讨论编号无效。".into()); }
    let (api, owner, repo) = repo_target(&repo_root)?;
    let raw: Page<GhComment> = page(&client()?, &format!("{api}/repos/{owner}/{repo}/issues/{number}/comments"), &token().await?, page_number, 10).await?;
    checked_reply(Page { next_page: raw.next_page, items: raw.items.into_iter().map(Comment::from).collect() })
}

#[tauri::command]
pub async fn gh_review_page(repo_root: String, number: u64, page_number: u32) -> Result<Page<Review>, String> {
    if number == 0 { return Err("PR 编号无效。".into()); }
    let (api, owner, repo) = repo_target(&repo_root)?;
    let raw: Page<GhReview> = page(&client()?, &format!("{api}/repos/{owner}/{repo}/pulls/{number}/reviews"), &token().await?, page_number, 10).await?;
    checked_reply(Page { next_page: raw.next_page, items: raw.items.into_iter().map(Review::from).collect() })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFile {
    pub old_path: Option<String>, pub new_path: Option<String>, pub status: String,
    pub hunks: Vec<super::DiffHunk>, pub patch_status: String,
}

fn patch_complete(patch: &str) -> bool {
    let mut expected = None;
    let (mut old, mut new) = (0usize, 0usize);
    for line in patch.lines() {
        if line.starts_with("@@ ") {
            if expected.is_some_and(|counts| counts != (old, new)) { return false; }
            let mut parts = line.split_whitespace(); parts.next();
            let count = |part: Option<&str>, sign: char| -> Option<usize> {
                let value = part?.strip_prefix(sign)?;
                value.split_once(',').map_or(Some(1), |(_, count)| count.parse().ok())
            };
            expected = match (count(parts.next(), '-'), count(parts.next(), '+')) { (Some(a), Some(b)) => Some((a, b)), _ => return false };
            old = 0; new = 0;
        } else if expected.is_some() {
            match line.chars().next() { Some(' ') => { old += 1; new += 1; }, Some('-') => old += 1, Some('+') => new += 1,
                Some('\\') => {}, _ => return false }
        } else if !line.is_empty() { return false; }
    }
    expected.is_some_and(|counts| counts == (old, new))
}

fn file(raw: GhPrFile) -> PrFile {
    let status = map_file_status(&raw.status);
    let patch_status = match raw.patch.as_deref() {
        None => "unavailable",
        Some(patch) if patch.len() > 64 * 1024 => "overBudget",
        Some(patch) if !patch_complete(patch) => "incomplete",
        Some(_) => "available",
    };
    let mut hunks = if patch_status == "available" { raw.patch.as_deref().map(parse_patch).unwrap_or_default() } else { Vec::new() };
    let patch_status = if serde_json::to_vec(&hunks).map_or(true, |bytes| bytes.len() > 128 * 1024) {
        hunks.clear(); "overBudget"
    } else { patch_status };
    let old_path = if status == "added" { None } else { Some(raw.previous_filename.unwrap_or_else(|| raw.filename.clone())) };
    let new_path = if status == "deleted" { None } else { Some(raw.filename) };
    PrFile { old_path, new_path, status, patch_status: patch_status.into(), hunks }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDiffPage { pub items: Vec<PrFile>, pub next_page: Option<u32>, pub head_oid: String, pub base_oid: String, pub web_url: String, pub limited: bool }

async fn snapshot(client: &reqwest::Client, endpoint: &str, credential: &str) -> Result<GhPull, String> {
    let response = with_headers(client.get(endpoint), credential).send().await.map_err(|error| format!("读取 PR 版本失败: {error}"))?;
    read(response).await
}

async fn diff_page(client: &reqwest::Client, endpoint: &str, credential: &str, page_number: u32, expected_head: Option<&str>, expected_base: Option<&str>) -> Result<PrDiffPage, String> {
    let before = snapshot(client, endpoint, credential).await?;
    let head = before.head.sha.as_deref().ok_or("PR 缺少来源提交标识。")?;
    let base = before.base.sha.as_deref().ok_or("PR 缺少基线提交标识。")?;
    if expected_head.is_some_and(|oid| oid != head) || expected_base.is_some_and(|oid| oid != base) {
        return Err("PR 已更新，请刷新列表后重新选择。未混用不同版本。".into());
    }
    let raw: Page<GhPrFile> = page(client, &format!("{endpoint}/files"), credential, page_number, 5).await?;
    let after = snapshot(client, endpoint, credential).await?;
    if after.head.sha.as_deref() != Some(head) || after.base.sha.as_deref() != Some(base) {
        return Err("读取期间 PR 已更新，请重新选择。未返回混合版本。".into());
    }
    let limited = before.changed_files.is_some_and(|count| count > 3000);
    checked_reply(PrDiffPage { items: raw.items.into_iter().map(file).collect(), next_page: raw.next_page,
        head_oid: head.into(), base_oid: base.into(), web_url: format!("{}/files", before.html_url), limited })
}

#[tauri::command]
pub async fn gh_pr_diff_page(repo_root: String, number: u64, page_number: u32, expected_head: Option<String>, expected_base: Option<String>) -> Result<PrDiffPage, String> {
    if number == 0 { return Err("PR 编号无效。".into()); }
    let (api, owner, repo) = repo_target(&repo_root)?;
    tokio::time::timeout(Duration::from_secs(90), diff_page(&client()?, &format!("{api}/repos/{owner}/{repo}/pulls/{number}"), &token().await?, page_number, expected_head.as_deref(), expected_base.as_deref())).await
        .map_err(|_| "读取 PR 差异超时，请重试。".to_string())?
}

/// GitHub PR changes use merge-base...head, not base-tip..head.
#[tauri::command]
pub async fn gh_pr_local_base(repo_root: String, base_oid: String, head_oid: String) -> Result<String, String> {
    super::super::blocking(move || {
        let repo = super::super::open_repo(&repo_root)?;
        let base = git2::Oid::from_str(&base_oid)?;
        let head = git2::Oid::from_str(&head_oid)?;
        repo.find_commit(base)?; repo.find_commit(head)?;
        Ok(repo.merge_base(base, head)?.to_string())
    }).await.map_err(|error| format!("无法读取 PR 的共同祖先，请先获取两侧完整历史：{error}"))
}

#[cfg(test)]
#[path = "pages_tests.rs"]
mod tests;
