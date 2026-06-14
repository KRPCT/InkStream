//! git status：工作区/暂存区/未跟踪 + 当前分支。

use super::types::{GitFileStatus, GitStatus};
use super::GitError;
use git2::{Repository, Status, StatusOptions};

/// 收集工作区状态（纯函数，临时 repo 单测）。
pub fn collect_status(repo: &Repository) -> Result<GitStatus, GitError> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .include_ignored(false);
    let statuses = repo.statuses(Some(&mut opts))?;
    let mut files = Vec::with_capacity(statuses.len());
    for e in statuses.iter() {
        let s = e.status();
        files.push(GitFileStatus {
            path: e.path().unwrap_or("").to_string(),
            staged: s.intersects(
                Status::INDEX_NEW
                    | Status::INDEX_MODIFIED
                    | Status::INDEX_DELETED
                    | Status::INDEX_RENAMED
                    | Status::INDEX_TYPECHANGE,
            ),
            unstaged: s.intersects(
                Status::WT_NEW
                    | Status::WT_MODIFIED
                    | Status::WT_DELETED
                    | Status::WT_RENAMED
                    | Status::WT_TYPECHANGE,
            ),
            status: classify(s),
        });
    }
    Ok(GitStatus {
        branch: current_branch_name(repo),
        files,
    })
}

/// Status bitflag → 单语义标签（冲突优先，前端图标用）。
fn classify(s: Status) -> String {
    if s.contains(Status::CONFLICTED) {
        "conflicted"
    } else if s.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
        "deleted"
    } else if s.intersects(Status::WT_RENAMED | Status::INDEX_RENAMED) {
        "renamed"
    } else if s.intersects(Status::WT_TYPECHANGE | Status::INDEX_TYPECHANGE) {
        "typechange"
    } else if s.intersects(Status::INDEX_NEW) {
        "new"
    } else if s.intersects(Status::WT_MODIFIED | Status::INDEX_MODIFIED) {
        "modified"
    } else if s.intersects(Status::WT_NEW) {
        "untracked"
    } else {
        "modified"
    }
    .to_string()
}

/// 当前分支短名：HEAD 指向分支时取 shorthand；detached/unborn → None。
fn current_branch_name(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if head.is_branch() {
        // git2 0.21：Reference::shorthand 返回 Result<&str,_>（非 Option），失败折成 None。
        head.shorthand().ok().map(|s| s.to_string())
    } else {
        None
    }
}

#[tauri::command]
pub async fn git_status(repo_root: String) -> Result<GitStatus, String> {
    super::blocking(move || collect_status(&super::open_repo(&repo_root)?)).await
}
