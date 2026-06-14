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
use std::process::Command;

/// 产生提交类操作的结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOpResult {
    /// 成功时操作后的 HEAD oid；冲突/未产生提交时 None。
    pub oid: Option<String>,
    /// 是否有未解决冲突（工作区有冲突标记，需用户解决后再 commit）。
    pub conflicted: bool,
}

/// 跑一条 git 子命令 → (success, stdout, stderr)。无 shell（无注入），current_dir 锁定仓库。
fn run(repo: &str, args: &[&str]) -> Result<(bool, String, String), GitError> {
    let out = Command::new("git")
        .current_dir(repo)
        .args(args)
        .output()
        .map_err(|e| GitError::Internal(format!("无法执行 git（请确认已安装 git）: {e}")))?;
    Ok((
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    ))
}

/// 当前 HEAD oid（rev-parse）。
fn head_oid(repo: &str) -> Option<String> {
    match run(repo, &["rev-parse", "HEAD"]) {
        Ok((true, out, _)) => Some(out.trim().to_string()),
        _ => None,
    }
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
) -> Result<GitOpResult, String> {
    super::blocking(move || {
        let mut add: Vec<&str> = vec!["add"];
        if paths.is_empty() {
            add.push("-A");
        } else {
            // -- 终止符：防 path 以 - 开头被 git 当 flag（review 硬化）。
            add.push("--");
            add.extend(paths.iter().map(String::as_str));
        }
        let (ok, _, err) = run(&repo_root, &add)?;
        if !ok {
            return Err(GitError::Git(format!("git add 失败: {}", err_msg(&err, "未知错误"))));
        }
        let (ok, _, err) = run(&repo_root, &["commit", "-S", "-m", &message])?;
        if !ok {
            return Err(GitError::Git(format!("提交失败: {}", err_msg(&err, "无可提交的改动"))));
        }
        Ok(GitOpResult {
            oid: head_oid(&repo_root),
            conflicted: false,
        })
    })
    .await
}

/// 合并分支到当前分支（--no-ff 留 merge 提交，-S 签名，--no-edit 免编辑器）。冲突 → conflicted。
#[tauri::command]
pub async fn git_merge(repo_root: String, branch: String) -> Result<GitOpResult, String> {
    super::blocking(move || {
        // --end-of-options：防 branch 以 - 开头被当 flag（review 硬化）。
        let (ok, _, err) = run(
            &repo_root,
            &["merge", "--no-ff", "--no-edit", "-S", "--end-of-options", &branch],
        )?;
        finish_op(&repo_root, ok, &err, "合并失败")
    })
    .await
}

/// cherry-pick 一个提交到当前分支（-S 签名）。冲突 → conflicted。
#[tauri::command]
pub async fn git_cherry_pick(repo_root: String, oid: String) -> Result<GitOpResult, String> {
    super::blocking(move || {
        let (ok, _, err) = run(&repo_root, &["cherry-pick", "-S", "--end-of-options", &oid])?;
        finish_op(&repo_root, ok, &err, "cherry-pick 失败")
    })
    .await
}

/// revert 一个提交（生成反向提交，-S 签名，--no-edit）。冲突 → conflicted。
#[tauri::command]
pub async fn git_revert(repo_root: String, oid: String) -> Result<GitOpResult, String> {
    super::blocking(move || {
        let (ok, _, err) = run(&repo_root, &["revert", "--no-edit", "-S", "--end-of-options", &oid])?;
        finish_op(&repo_root, ok, &err, "revert 失败")
    })
    .await
}

/// 收尾 merge/cherry-pick/revert：成功取 HEAD；冲突 → conflicted（可解决）；非冲突失败 → best-effort 中止
/// 进行中操作再报错——否则遗留 MERGE_HEAD/CHERRY_PICK_HEAD/REVERT_HEAD 会让下一笔 commit 静默完成被放弃的
/// 操作、产出张冠李戴的多父提交（review 高危发现）。
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
    if let Some(sub) = in_progress_op(repo) {
        let _ = run(repo, &[sub, "--abort"]); // best-effort 还原，忽略其退出码
    }
    Err(GitError::Git(format!("{what}: {}", err_msg(err, "未知错误"))))
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
pub async fn git_abort_op(repo_root: String) -> Result<(), String> {
    super::blocking(move || {
        let Some(sub) = in_progress_op(&repo_root) else {
            return Err(GitError::Git("没有进行中的合并/拣选/回退操作".into()));
        };
        let (ok, _, err) = run(&repo_root, &[sub, "--abort"])?;
        if !ok {
            return Err(GitError::Git(format!("中止失败: {}", err_msg(&err, "未知错误"))));
        }
        Ok(())
    })
    .await
}
