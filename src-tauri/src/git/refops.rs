//! git 引用操作（不产生提交，走 git2）：checkout / 分支增删 / reset / tag。
//! 破坏性操作（checkout 弃改动、reset --hard）由 Rust 护栏 + 前端二次确认双重把关。

use super::GitError;
use git2::{build::CheckoutBuilder, BranchType, Oid, ResetType};

/// checkout 分支或提交。force=true 丢弃工作区冲突改动（危险，前端二次确认后才传）。
/// 默认 safe()：有冲突改动则报错、绝不丢数据。
#[tauri::command]
pub async fn git_checkout(repo_root: String, target: String, force: bool) -> Result<(), String> {
    super::blocking(move || {
        let repo = super::open_repo(&repo_root)?;
        let (obj, reference) = repo
            .revparse_ext(&target)
            .map_err(|_| GitError::Git(format!("找不到「{target}」")))?;
        let mut co = CheckoutBuilder::new();
        if force {
            co.force();
        } else {
            co.safe();
        }
        repo.checkout_tree(&obj, Some(&mut co))
            .map_err(|e| GitError::Git(format!("切换失败（可能有未提交改动冲突）: {}", e.message())))?;
        match reference {
            Some(r) => {
                // git2 0.21：Reference::name 返回 Result<&str>（非 UTF-8 名时 Err）。
                let name = r.name().map_err(GitError::from)?;
                repo.set_head(name).map_err(GitError::from)?;
            }
            None => repo.set_head_detached(obj.id()).map_err(GitError::from)?,
        }
        Ok(())
    })
    .await
}

/// 在指定提交（None=HEAD）创建本地分支；checkout=true 同时切过去。
#[tauri::command]
pub async fn git_create_branch(
    repo_root: String,
    name: String,
    target_oid: Option<String>,
    checkout: bool,
) -> Result<(), String> {
    super::blocking(move || {
        let repo = super::open_repo(&repo_root)?;
        let commit = match target_oid {
            Some(s) => repo
                .find_commit(Oid::from_str(&s).map_err(GitError::from)?)
                .map_err(GitError::from)?,
            None => repo.head().and_then(|h| h.peel_to_commit()).map_err(GitError::from)?,
        };
        repo.branch(&name, &commit, false)
            .map_err(|e| GitError::Git(format!("创建分支失败: {}", e.message())))?;
        if checkout {
            let refname = format!("refs/heads/{name}");
            let obj = repo.revparse_single(&refname).map_err(GitError::from)?;
            let mut co = CheckoutBuilder::new();
            co.safe();
            if let Err(e) = repo.checkout_tree(&obj, Some(&mut co)) {
                // 切换失败（多为未提交改动冲突）：回滚刚建的分支，避免「分支已建却报创建失败」误导 + 残留。
                if let Ok(mut b) = repo.find_branch(&name, BranchType::Local) {
                    let _ = b.delete();
                }
                return Err(GitError::Git(format!(
                    "切换到新分支失败（可能有未提交改动冲突）: {}",
                    e.message()
                )));
            }
            repo.set_head(&refname).map_err(GitError::from)?;
        }
        Ok(())
    })
    .await
}

/// 删除本地分支（拒删当前 HEAD 分支）。强删未合并分支由前端二次确认把关。
#[tauri::command]
pub async fn git_delete_branch(repo_root: String, name: String) -> Result<(), String> {
    super::blocking(move || {
        let repo = super::open_repo(&repo_root)?;
        let mut b = repo
            .find_branch(&name, BranchType::Local)
            .map_err(|_| GitError::Git(format!("分支不存在: {name}")))?;
        if b.is_head() {
            return Err(GitError::Git("不能删除当前所在分支".into()));
        }
        b.delete()
            .map_err(|e| GitError::Git(format!("删除分支失败: {}", e.message())))?;
        Ok(())
    })
    .await
}

/// reset 到某提交。hard 模式护栏：confirm_hard 缺省即拒绝（防误触丢工作区改动）。
#[tauri::command]
pub async fn git_reset(
    repo_root: String,
    target_oid: String,
    mode: String,
    confirm_hard: bool,
) -> Result<(), String> {
    super::blocking(move || {
        let repo = super::open_repo(&repo_root)?;
        let obj = repo
            .find_object(Oid::from_str(&target_oid).map_err(GitError::from)?, None)
            .map_err(GitError::from)?;
        let rt = match mode.as_str() {
            "soft" => ResetType::Soft,
            "mixed" => ResetType::Mixed,
            "hard" => {
                if !confirm_hard {
                    return Err(GitError::Git("reset --hard 会丢弃所有未提交改动，需显式确认".into()));
                }
                ResetType::Hard
            }
            _ => return Err(GitError::Git(format!("未知 reset 模式: {mode}"))),
        };
        repo.reset(&obj, rt, None).map_err(GitError::from)?;
        Ok(())
    })
    .await
}

/// 创建 tag：message=Some → 附注 tag（用 user.signingkey 之外的普通签名身份），None → 轻量 tag。
#[tauri::command]
pub async fn git_tag_create(
    repo_root: String,
    name: String,
    target_oid: Option<String>,
    message: Option<String>,
) -> Result<(), String> {
    super::blocking(move || {
        let repo = super::open_repo(&repo_root)?;
        let oid = match target_oid {
            Some(s) => Oid::from_str(&s).map_err(GitError::from)?,
            None => repo.head().and_then(|h| h.peel_to_commit()).map_err(GitError::from)?.id(),
        };
        let target = repo.find_object(oid, None).map_err(GitError::from)?;
        match message {
            Some(msg) => {
                let sig = repo.signature().map_err(GitError::from)?;
                repo.tag(&name, &target, &sig, &msg, false)
                    .map_err(|e| GitError::Git(format!("创建标签失败: {}", e.message())))?;
            }
            None => {
                repo.tag_lightweight(&name, &target, false)
                    .map_err(|e| GitError::Git(format!("创建标签失败: {}", e.message())))?;
            }
        }
        Ok(())
    })
    .await
}

/// 删除 tag（短名，无 refs/tags/ 前缀）。
#[tauri::command]
pub async fn git_tag_delete(repo_root: String, name: String) -> Result<(), String> {
    super::blocking(move || {
        let repo = super::open_repo(&repo_root)?;
        repo.tag_delete(&name)
            .map_err(|e| GitError::Git(format!("删除标签失败: {}", e.message())))?;
        Ok(())
    })
    .await
}
