//! git stash（git2，需 &mut Repository）。save/pop/drop/list。

use super::GitError;
use git2::StashFlags;
use serde::Serialize;

/// 单条 stash（index 越小越新，pop/drop 按 index 定位）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub oid: String,
}

fn verify_entry(repo: &mut git2::Repository, index: usize, expected: Option<&str>) -> Result<(), GitError> {
    let Some(expected) = expected else { return Ok(()); };
    let expected = git2::Oid::from_str(expected).map_err(|_| GitError::Git("暂存记录标识无效，请刷新列表".into()))?;
    let mut actual = None;
    repo.stash_foreach(|position, _, oid| {
        if position == index { actual = Some(*oid); false } else { true }
    })?;
    if actual != Some(expected) { return Err(GitError::Git("暂存列表已变化，未操作其他记录；请刷新后重试".into())); }
    Ok(())
}

/// 暂存当前改动（含未跟踪文件）。message 空 → "WIP"。
#[tauri::command]
pub async fn git_stash_save(repo_root: String, message: String) -> Result<(), String> {
    super::blocking(move || {
        let mut repo = super::open_repo(&repo_root)?;
        let _lease = super::rebase_registry::lock_worktree(&repo)?;
        let sig = repo.signature().map_err(GitError::from)?;
        let msg = if message.trim().is_empty() {
            "WIP"
        } else {
            message.as_str()
        };
        repo.stash_save(&sig, msg, Some(StashFlags::INCLUDE_UNTRACKED))
            .map_err(|e| GitError::Git(format!("暂存失败: {}", e.message())))?;
        Ok(())
    })
    .await
}

/// Restore first and inspect the resulting index; a libgit2 success code alone can include conflicts.
#[tauri::command]
pub async fn git_stash_pop(repo_root: String, index: usize, expected_oid: Option<String>) -> Result<(), String> {
    super::blocking(move || {
        let mut repo = super::open_repo(&repo_root)?;
        let _lease = super::rebase_registry::lock_worktree(&repo)?;
        verify_entry(&mut repo, index, expected_oid.as_deref())?;
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout.safe().allow_conflicts(true);
        let mut options = git2::StashApplyOptions::new();
        options.checkout_options(checkout);
        repo.stash_apply(index, Some(&mut options))
            .map_err(|e| GitError::Git(format!("恢复暂存失败（可能有冲突）: {}", e.message())))?;
        let mut restored_index = repo.index()?;
        restored_index.read(true)?;
        if restored_index.has_conflicts() {
            return Err(GitError::Git("恢复暂存产生冲突；暂存记录已保留，请先解决冲突".into()));
        }
        verify_entry(&mut repo, index, expected_oid.as_deref())?;
        repo.stash_drop(index)
            .map_err(|e| GitError::Git(format!("暂存已恢复，但记录未能移除: {}", e.message())))?;
        Ok(())
    })
    .await
}

/// 删除指定 stash（不恢复）。前端二次确认把关。
#[tauri::command]
pub async fn git_stash_drop(repo_root: String, index: usize, expected_oid: Option<String>) -> Result<(), String> {
    super::blocking(move || {
        let mut repo = super::open_repo(&repo_root)?;
        let _lease = super::rebase_registry::lock_worktree(&repo)?;
        verify_entry(&mut repo, index, expected_oid.as_deref())?;
        repo.stash_drop(index)
            .map_err(|e| GitError::Git(format!("删除暂存失败: {}", e.message())))?;
        Ok(())
    })
    .await
}

/// 列出全部 stash。
#[tauri::command]
pub async fn git_stash_list(repo_root: String) -> Result<Vec<StashEntry>, String> {
    super::blocking(move || {
        let mut repo = super::open_repo(&repo_root)?;
        let mut out = Vec::new();
        repo.stash_foreach(|index, message, oid| {
            out.push(StashEntry {
                index,
                message: message.to_string(),
                oid: oid.to_string(),
            });
            true
        })
        .map_err(GitError::from)?;
        Ok(out)
    })
    .await
}

#[cfg(test)]
#[path = "stash_tests.rs"]
mod tests;
