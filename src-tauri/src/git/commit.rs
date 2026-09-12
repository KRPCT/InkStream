//! git 写命令——**产生提交的操作走系统 git CLI**（commit/merge/cherry-pick/revert），保 SSH 签名 Verified 硬门。
//!
//! 用户裁定：libgit2 不原生签名提交（手动 commit_signed 路径 Verified 回归成本高，见 libgit2#6397），
//! 故凡创建提交的操作都用 `-S` 经系统 git，复用用户 gpg.format=ssh + user.signingkey 配置，与命令行 git
//! 字节一致 → GitHub Verified 稳。引用操作（checkout/branch/reset/tag/stash）走 git2（见 refops/stash）。
//!
//! 注入安全：std::process::Command **不经 shell**，参数按 argv 数组传递——message/oid/branch 即使含
//! 空格/引号/分号/`$()` 等元字符也只是单个 argv 元素，无 shell 注入面。current_dir 锁定仓库根。

use super::GitError;
use serde::Serialize;
use std::time::{Duration, Instant};

const OPERATION_TIMEOUT: Duration = Duration::from_secs(120);

/// One admission and deadline cover staging, signing/hooks and any recovery command.
struct Operation {
    repo: git2::Repository,
    lease: super::rebase_registry::Lease,
    deadline: Instant,
}
impl Operation {
    fn begin(root: &str, request_id: Option<String>, timeout: Duration) -> Result<Self, GitError> {
        let repo = super::open_repo(root)?;
        let lease = super::rebase_registry::acquire(&repo, request_id.unwrap_or_else(super::rebase_registry::request_id))?;
        if super::rebase_state::in_progress(&repo) {
            return Err(GitError::Git("变基尚未结束，请先继续、跳过或中止变基".into()));
        }
        Ok(Self { repo, lease, deadline: Instant::now() + timeout })
    }

    fn run(&self, args: &[&str]) -> Result<(bool, String, String), GitError> {
        let spec = super::rebase::local_spec(&self.repo, args.iter().map(|arg| (*arg).into()).collect())?;
        let out = super::rebase_process::run_process(&spec, &self.lease.cancelled,
            self.deadline.saturating_duration_since(Instant::now())).map_err(GitError::Git)?;
        let diagnostic = if out.stderr.trim().is_empty() { out.stdout.trim() } else { out.stderr.trim() };
        if let Some(error) = out.cleanup_error {
            return Err(GitError::Git(format!("Git 进程回收未确认：{error}。工作树和暂存状态已保留；请检查后恢复。\n{diagnostic}")));
        }
        if let Some(reason) = out.interruption {
            let reason = match reason {
                super::rebase_process::StopReason::TimedOut => "Git 操作超过执行期限，已停止",
                super::rebase_process::StopReason::Cancelled => "Git 操作已取消",
            };
            return Err(GitError::Git(format!("{reason}。工作树和暂存状态已保留；请检查后重试或中止未完成的合并。\n{diagnostic}")));
        }
        Ok((out.exit_code == Some(0), out.stdout, out.stderr))
    }
}

/// 产生提交类操作的结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOpResult {
    /// 成功时操作后的 HEAD oid；冲突/未产生提交时 None。
    pub oid: Option<String>,
    /// 是否有未解决冲突（工作区有冲突标记，需用户解决后再 commit）。
    pub conflicted: bool,
}

/// Read HEAD directly; status reporting must not start another hook/signing process.
fn head_oid(repo: &str) -> Option<String> {
    super::open_repo(repo).ok()?.head().ok()?.target().map(|oid| oid.to_string())
}

/// 工作区是否有未解决冲突（git2 读 index）。
fn has_conflicts(repo: &str) -> bool {
    super::open_repo(repo)
        .ok()
        .and_then(|r| r.index().ok())
        .map(|i| i.has_conflicts())
        .unwrap_or(false)
}

/// stderr 去空白；为空时给兜底文案。
fn err_msg(stderr: &str, fallback: &str) -> String {
    let t = stderr.trim();
    if t.is_empty() {
        fallback.to_string()
    } else {
        t.to_string()
    }
}

/// 暂存 + 签名提交（硬门：-S 强制签名）。paths 空 → stage 全部改动(-A)，否则 stage 指定相对路径。
#[tauri::command]
pub async fn git_commit(
    repo_root: String,
    message: String,
    paths: Vec<String>,
    request_id: Option<String>,
) -> Result<GitOpResult, String> {
    super::blocking(move || {
        commit(&repo_root, &message, &paths, request_id, OPERATION_TIMEOUT)
    }).await
}

fn commit(repo_root: &str, message: &str, paths: &[String], request_id: Option<String>, timeout: Duration) -> Result<GitOpResult, GitError> {
        let operation = Operation::begin(repo_root, request_id, timeout)?;
        let mut add: Vec<&str> = vec!["add"];
        if paths.is_empty() {
            add.push("-A");
        } else {
            // -- 终止符：防 path 以 - 开头被 git 当 flag（review 硬化）。
            add.push("--");
            add.extend(paths.iter().map(String::as_str));
        }
        let (ok, _, err) = operation.run(&add)?;
        if !ok {
            return Err(GitError::Git(format!("git add 失败: {}", err_msg(&err, "未知错误"))));
        }
        let (ok, _, err) = operation.run(&["commit", "-S", "-m", message])?;
        if !ok {
            return Err(GitError::Git(format!("提交失败: {}", err_msg(&err, "无可提交的改动"))));
        }
        Ok(GitOpResult {
            oid: head_oid(repo_root),
            conflicted: false,
        })
}

/// 合并分支到当前分支（--no-ff 留 merge 提交，-S 签名，--no-edit 免编辑器）。冲突 → conflicted。
#[tauri::command]
pub async fn git_merge(repo_root: String, branch: String, request_id: Option<String>) -> Result<GitOpResult, String> {
    super::blocking(move || {
        let operation = Operation::begin(&repo_root, request_id, OPERATION_TIMEOUT)?;
        // --end-of-options：防 branch 以 - 开头被当 flag（review 硬化）。
        let (ok, _, err) = operation.run(
            &["merge", "--no-ff", "--no-edit", "-S", "--end-of-options", &branch],
        )?;
        finish_op(&repo_root, ok, &err, "合并失败")
    })
    .await
}

/// cherry-pick 一个提交到当前分支（-S 签名）。冲突 → conflicted。
#[tauri::command]
pub async fn git_cherry_pick(repo_root: String, oid: String, request_id: Option<String>) -> Result<GitOpResult, String> {
    super::blocking(move || {
        let operation = Operation::begin(&repo_root, request_id, OPERATION_TIMEOUT)?;
        let (ok, _, err) = operation.run(&["cherry-pick", "-S", "--end-of-options", &oid])?;
        finish_op(&repo_root, ok, &err, "cherry-pick 失败")
    })
    .await
}

/// revert 一个提交（生成反向提交，-S 签名，--no-edit）。冲突 → conflicted。
#[tauri::command]
pub async fn git_revert(repo_root: String, oid: String, request_id: Option<String>) -> Result<GitOpResult, String> {
    super::blocking(move || {
        let operation = Operation::begin(&repo_root, request_id, OPERATION_TIMEOUT)?;
        let (ok, _, err) = operation.run(&["revert", "--no-edit", "-S", "--end-of-options", &oid])?;
        finish_op(&repo_root, ok, &err, "revert 失败")
    })
    .await
}

/// Report the actual remaining state; only an explicit abort may discard an incomplete operation.
fn finish_op(repo: &str, ok: bool, err: &str, what: &str) -> Result<GitOpResult, GitError> {
    if ok {
        return Ok(GitOpResult {
            oid: head_oid(repo),
            conflicted: false,
        });
    }
    if has_conflicts(repo) {
        return Ok(GitOpResult {
            oid: None,
            conflicted: true,
        });
    }
    let recovery = if in_progress_op(repo).is_some() { "；未完成操作已保留，请检查后继续提交，或执行“中止本地 Git 操作”" } else { "" };
    Err(GitError::Git(format!("{what}: {}{recovery}", err_msg(err, "未知错误"))))
}

/// 检测进行中的 merge/cherry-pick/revert（按 .git 下 *_HEAD 标记），返回对应 git 子命令名供 --abort。
fn in_progress_op(repo: &str) -> Option<&'static str> {
    let gitdir = super::open_repo(repo).ok()?.path().to_path_buf();
    if gitdir.join("MERGE_HEAD").exists() {
        Some("merge")
    } else if gitdir.join("CHERRY_PICK_HEAD").exists() {
        Some("cherry-pick")
    } else if gitdir.join("REVERT_HEAD").exists() {
        Some("revert")
    } else {
        None
    }
}

/// 中止进行中的 merge/cherry-pick/revert，把仓库还原到操作前（冲突卡死时的安全出口）。
#[tauri::command]
pub async fn git_abort_op(repo_root: String, request_id: Option<String>) -> Result<(), String> {
    super::blocking(move || {
        if super::rebase_state::in_progress(&super::open_repo(&repo_root)?) {
            let result = super::rebase::execute(&repo_root, request_id.unwrap_or_else(super::rebase_registry::request_id), super::rebase::RebaseAction::Abort)?;
            return if result.outcome == super::rebase::RebaseOutcome::Aborted { Ok(()) }
                else { Err(GitError::Git(result.error.unwrap_or_else(|| "中止变基未完成".into()))) };
        }
        let operation = Operation::begin(&repo_root, request_id, OPERATION_TIMEOUT)?;
        let Some(sub) = in_progress_op(&repo_root) else {
            return Err(GitError::Git("没有进行中的合并/拣选/回退操作".into()));
        };
        let (ok, _, err) = operation.run(&[sub, "--abort"])?;
        if !ok {
            return Err(GitError::Git(format!("中止失败: {}", err_msg(&err, "未知错误"))));
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_cancel_operation(repo_root: String, request_id: String) -> Result<bool, String> {
    super::blocking(move || super::rebase_registry::cancel(&super::open_repo(&repo_root)?, request_id)).await
}

#[cfg(test)]
#[path = "commit_tests.rs"]
mod tests;
