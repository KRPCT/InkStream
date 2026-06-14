//! git branch_list：本地 + 远程分支，含 ahead/behind 与当前 HEAD 标记。

use super::types::BranchInfo;
use super::GitError;
use git2::{BranchType, Repository};

/// 列出全部分支（纯函数，临时 repo 单测）。
pub fn list_branches(repo: &Repository) -> Result<Vec<BranchInfo>, GitError> {
    let mut out = Vec::new();
    for item in repo.branches(None)? {
        let (branch, btype) = item?;
        let name = branch.name()?.unwrap_or("").to_string();
        let target = branch.get().target();
        let is_remote = btype == BranchType::Remote;
        // is_head 按 HEAD 符号引用判定（git_branch_is_head），非 oid 相等——否则多分支同 tip 时全被误标。
        let is_head = branch.is_head();
        let (mut ahead, mut behind, mut upstream) = (0, 0, None);
        if !is_remote {
            if let Ok(up) = branch.upstream() {
                upstream = up.name()?.map(|s| s.to_string());
                if let (Some(l), Some(u)) = (target, up.get().target()) {
                    if let Ok((a, b)) = repo.graph_ahead_behind(l, u) {
                        ahead = a;
                        behind = b;
                    }
                }
            }
        }
        out.push(BranchInfo {
            name,
            is_remote,
            is_head,
            upstream,
            ahead,
            behind,
            target: target.map(|o| o.to_string()),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn git_branch_list(repo_root: String) -> Result<Vec<BranchInfo>, String> {
    super::blocking(move || list_branches(&super::open_repo(&repo_root)?)).await
}
