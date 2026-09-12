//! Small legacy entrypoints; current conflict UI uses snapshot metadata and bounded Raw sessions.
use super::{conflict_snapshot, GitError};
use std::time::{Duration, Instant};

#[tauri::command]
pub async fn git_read_conflict(repo_root: String, path: String) -> Result<String, String> {
    super::blocking(move || conflict_snapshot::legacy_read(&repo_root, &path).map_err(GitError::Git)).await
}

#[tauri::command]
pub async fn git_resolve_conflict(repo_root: String, path: String, content: String, expected_content: Option<String>) -> Result<(), String> {
    super::blocking(move || {
        let expected = expected_content.ok_or_else(|| GitError::Git("解决冲突必须绑定已读取的基线。".into()))?;
        if content.len() > 1024 * 1024 || expected.len() > 1024 * 1024 {
            return Err(GitError::Git("冲突正文超过 1MiB，请使用 Raw 完整写入通道。".into()));
        }
        let snapshot = conflict_snapshot::metadata(&repo_root, &path).map_err(GitError::Git)?;
        if snapshot.baseline.working_oid != git2::Oid::hash_object(git2::ObjectType::Blob, expected.as_bytes())?.to_string() {
            return Err(GitError::Git("冲突文件已变化，未覆盖新内容；请重新读取冲突".into()));
        }
        let (target, guard) = conflict_snapshot::WriteGuard::begin(repo_root, path, snapshot.baseline, super::rebase_registry::request_id()).map_err(GitError::Git)?;
        guard.verify_content(content.as_bytes()).map_err(GitError::Git)?;
        crate::files::write_atomic(&target, &content).map_err(GitError::Git)?;
        guard.stage(Instant::now() + Duration::from_secs(30)).map_err(GitError::Git)
    }).await
}
