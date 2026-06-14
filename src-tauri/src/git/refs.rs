//! git refs：分支（本地+远程）+ tag，按指向 commit oid 列出（git-graph 行内徽章数据源，W2）。

use super::types::GitRef;
use super::GitError;
use git2::{BranchType, ObjectType, Repository};

/// 列出全部 ref（纯函数，临时 repo 单测）。
/// 当前分支（HEAD）不单列——前端按 useGitStore.status.branch 高亮对应 localBranch 徽章。
pub fn list_refs(repo: &Repository) -> Result<Vec<GitRef>, GitError> {
    let mut out = Vec::new();
    for item in repo.branches(None)? {
        let (branch, btype) = item?;
        let Some(name) = branch.name()? else { continue };
        let Some(oid) = branch.get().target() else {
            continue;
        };
        out.push(GitRef {
            name: name.to_string(),
            kind: if btype == BranchType::Remote {
                "remoteBranch"
            } else {
                "localBranch"
            }
            .to_string(),
            target_oid: oid.to_string(),
        });
    }
    // tag：lightweight tag 的 oid 即 commit；annotated tag peel 到 commit（否则 oid 对不上任何 commit 行）。
    repo.tag_foreach(|oid, raw_name| {
        let full = String::from_utf8_lossy(raw_name);
        let short = full.strip_prefix("refs/tags/").unwrap_or(&full).to_string();
        let target = repo
            .find_object(oid, None)
            .ok()
            .and_then(|o| o.peel(ObjectType::Commit).ok())
            .map(|c| c.id())
            .unwrap_or(oid);
        out.push(GitRef {
            name: short,
            kind: "tag".to_string(),
            target_oid: target.to_string(),
        });
        true
    })?;
    Ok(out)
}

#[tauri::command]
pub async fn git_refs(repo_root: String) -> Result<Vec<GitRef>, String> {
    super::blocking(move || list_refs(&super::open_repo(&repo_root)?)).await
}
