//! Phase 12 DIFF-03 prose 三向合并：读冲突工作文件（含合并标记）+ 写回并标记 resolved。
//!
//! 走 git 自身合并产物：merge 冲突时 git 已把可自动合并的改动并入工作文件，仅在真冲突处留下
//! `<<<<<<< / ======= / >>>>>>>` 标记。前端解析标记，对每个冲突块用句级 diff 呈现 ours↔theirs 差异，
//! 用户按块采纳后组装结果。本模块只负责读工作文件与「写回 + git add 标记 resolved」（git add 即清
//! 除该文件的冲突 stage）。
//!
//! 安全：两命令均经 path_guard（canonicalize_in_root）把仓库相对 path 校验落在仓库根内——拒绝绝对路径 /
//! `../` 逃逸 / symlink 逃逸（与 files.rs 全部读写命令同纪律，绝不因 IPC 入参越界读写）。写回复用 files.rs
//! 的 WR-04 原子写（temp + sync_all + rename + 失败清理），git add 走 git CLI（`--` 注入防护）。

use super::GitError;
use crate::path_guard::canonicalize_in_root;
use std::path::Path;
use std::time::Duration;

/// 读取冲突文件的工作区内容（含 git 合并标记）。
#[tauri::command]
pub async fn git_read_conflict(repo_root: String, path: String) -> Result<String, String> {
    super::blocking(move || {
        // 冲突工作文件已存在 → canonicalize_in_root 校验落在仓库根内（拒绝越界）。
        let target = canonicalize_in_root(Path::new(&repo_root), &path).map_err(GitError::Git)?;
        std::fs::read_to_string(&target).map_err(|e| GitError::Git(format!("读取冲突文件失败: {e}")))
    })
    .await
}

/// 写回解决后的内容并 `git add` 标记 resolved（清除该文件的冲突 stage）。
#[tauri::command]
pub async fn git_resolve_conflict(
    repo_root: String,
    path: String,
    content: String,
    expected_content: Option<String>,
) -> Result<(), String> {
    super::blocking(move || {
        let repo = super::open_repo(&repo_root)?;
        let lease = super::rebase_registry::acquire(&repo, super::rebase_registry::request_id())?;
        let target = canonicalize_in_root(Path::new(&repo_root), &path).map_err(GitError::Git)?;
        if let Some(expected) = expected_content {
            let actual = std::fs::read_to_string(&target).map_err(|e| GitError::Git(format!("读取当前冲突文件失败: {e}")))?;
            if actual != expected { return Err(GitError::Git("冲突文件已变化，未覆盖新内容；请重新读取冲突".into())); }
        }
        // 复用 files.rs 的 WR-04 原子写（temp + sync_all + rename + 失败清理）。
        crate::files::write_atomic(&target, &content).map_err(GitError::Git)?;
        let spec = super::rebase::local_spec(&repo, ["add", "--", &path].map(std::ffi::OsString::from).to_vec())?;
        let out = super::rebase_process::run_process(&spec, &lease.cancelled, Duration::from_secs(30)).map_err(GitError::Git)?;
        if out.exit_code != Some(0) || out.interruption.is_some() || out.cleanup_error.is_some() {
            return Err(GitError::Git(format!(
                "git add 失败: {}",
                out.cleanup_error.as_deref().unwrap_or_else(|| if out.stderr.trim().is_empty() { "执行未完成，请检查变基状态后重试" } else { out.stderr.trim() })
            )));
        }
        Ok(())
    })
    .await
}
