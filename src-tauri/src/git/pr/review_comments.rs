use super::{repo_target, token, with_headers, GhComment};
use serde::{Deserialize, Serialize};
use super::http::{client, read};
use std::time::Duration;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    id: u64,
    in_reply_to_id: Option<u64>,
    author: String,
    body: String,
    path: String,
    line: Option<u32>,
    original_line: Option<u32>,
    diff_hunk: String,
    url: String,
    created_at: String,
}

#[derive(Deserialize)]
struct RawComment {
    #[serde(flatten)]
    comment: GhComment,
    #[serde(default)]
    in_reply_to_id: Option<u64>,
    path: String,
    line: Option<u32>,
    original_line: Option<u32>,
    #[serde(default)]
    diff_hunk: String,
}
impl From<RawComment> for ReviewComment {
    fn from(raw: RawComment) -> Self {
        Self { id: raw.comment.id, in_reply_to_id: raw.in_reply_to_id,
            author: raw.comment.user.login, body: raw.comment.body.unwrap_or_default(),
            path: raw.path, line: raw.line, original_line: raw.original_line, diff_hunk: raw.diff_hunk,
            url: raw.comment.html_url, created_at: raw.comment.created_at }
    }
}

async fn list(client: &reqwest::Client, endpoint: &str, credential: &str) -> Result<Vec<ReviewComment>, String> {
    let mut comments = Vec::new();
    let mut body_bytes = 0;
    for page in 1..=50 {
        let response = with_headers(client.get(format!("{endpoint}?per_page=100&page={page}&sort=created&direction=asc")), credential)
            .send().await.map_err(|error| format!("连接 GitHub 失败: {error}"))?;
        let raw: Vec<RawComment> = read(response).await?;
        let finished = raw.len() < 100;
        body_bytes += raw.iter().map(|comment| comment.comment.body.as_ref().map_or(0, String::len) + comment.diff_hunk.len()).sum::<usize>();
        if body_bytes > 16 * 1024 * 1024 { return Err("审阅讨论过大，请在 GitHub 查看。".into()); }
        comments.extend(raw.into_iter().map(ReviewComment::from));
        if finished { return Ok(comments); }
    }
    Err("审阅讨论超过本次读取上限，请在 GitHub 查看。".into())
}

async fn reply(client: &reqwest::Client, endpoint: &str, credential: &str, body: &str) -> Result<ReviewComment, String> {
    let response = with_headers(client.post(endpoint), credential).json(&serde_json::json!({ "body": body }))
        .send().await.map_err(|error| format!("回复发送结果未确认，请刷新讨论后再重试：{error}"))?;
    Ok(read::<RawComment>(response).await?.into())
}

#[tauri::command]
pub async fn gh_pr_review_comments(repo_root: String, number: u64) -> Result<Vec<ReviewComment>, String> {
    if number == 0 { return Err("PR 编号无效".into()); }
    let (api, owner, repo) = repo_target(&repo_root)?;
    let credential = token().await?;
    let client = client()?;
    let endpoint = format!("{api}/repos/{owner}/{repo}/pulls/{number}/comments");
    tokio::time::timeout(Duration::from_secs(90), list(&client, &endpoint, &credential)).await
        .map_err(|_| "审阅讨论读取超时，请重试。".to_string())?
}

#[tauri::command]
pub async fn gh_pr_reply(repo_root: String, number: u64, comment_id: u64, body: String) -> Result<ReviewComment, String> {
    if number == 0 || comment_id == 0 { return Err("PR 或评论编号无效".into()); }
    if body.trim().is_empty() || body.len() > 65_536 { return Err("回复不能为空；内容过长时请拆分。".into()); }
    let (api, owner, repo) = repo_target(&repo_root)?;
    let credential = token().await?;
    reply(&client()?, &format!("{api}/repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies"), &credential, body.trim()).await
}

#[cfg(test)]
#[path = "review_comments_tests.rs"]
mod tests;
