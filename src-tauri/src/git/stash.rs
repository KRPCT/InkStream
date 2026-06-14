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

/// 暂存当前改动（含未跟踪文件）。message 空 → "WIP"。
#[tauri::command]
pub async fn git_stash_save(repo_root: String, message: String) -> Result<(), String> {
    super::blocking(move || {
        let mut repo = super::open_repo(&repo_root)?;
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

/// 恢复并删除指定 stash（冲突时 libgit2 报错且不 drop，数据安全）。
#[tauri::command]
pub async fn git_stash_pop(repo_root: String, index: usize) -> Result<(), String> {
    super::blocking(move || {
        let mut repo = super::open_repo(&repo_root)?;
        repo.stash_pop(index, None)
            .map_err(|e| GitError::Git(format!("恢复暂存失败（可能有冲突）: {}", e.message())))?;
        Ok(())
    })
    .await
}

/// 删除指定 stash（不恢复）。前端二次确认把关。
#[tauri::command]
pub async fn git_stash_drop(repo_root: String, index: usize) -> Result<(), String> {
    super::blocking(move || {
        let mut repo = super::open_repo(&repo_root)?;
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
