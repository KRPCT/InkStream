//! 远程操作（Phase 6 W4 / GIT-06）：clone/fetch/push/pull 走**系统 git CLI（sidecar）**。
//!
//! 为何不用 git2/libssh2：实测 Windows 上 libgit2 vendored 的 libssh2（WinCNG backend）不支持 ed25519
//! 密钥（用户密钥即 ed25519），SSH 认证必失败（系统 git/OpenSSH 同密钥 clone 成功，已验证）。系统 git 原生
//! 支持 ed25519 + ssh-agent + known_hosts，跨平台，且与 W3 commit 签名同走 git CLI 范式一致。凭据/known_hosts
//! 全由系统 git/OpenSSH 处理（无需自写 CredCtx/known_hosts 校验）。
//!
//! 进度：git --progress 把进度写 stderr（用 \r 刷新同一行），逐段（\r/\n 分隔）经 tauri Channel 推前端。
//! 注入安全：std::process::Command argv 数组无 shell；远程/分支/url 前加 -- 终止符防 flag 注入。

use super::GitError;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

/// 传输进度（git --progress 的 stderr 行）。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProgress {
    pub line: String,
}

/// pull 结果。
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PullOutcome {
    UpToDate,
    FastForward,
    /// 本地与远程分叉，需手动合并/rebase（pull 仅做 ff-only，不自动产 merge 提交）。
    Diverged,
}

/// 跑 git 远程子命令，stderr 进度逐段推 channel；返回 (success, stderr 全文)。
/// stdout 置 null（远程命令进度全在 stderr，无需 stdout，免双管道阻塞）。
fn run_streamed(
    repo: Option<&str>,
    args: &[&str],
    channel: &Channel<GitProgress>,
) -> Result<(bool, String), GitError> {
    let mut cmd = Command::new("git");
    if let Some(r) = repo {
        cmd.current_dir(r);
    }
    let mut child = cmd
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| GitError::Internal(format!("无法执行 git（请确认已安装）: {e}")))?;
    let mut collected = String::new();
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr);
        let mut seg = Vec::new();
        while read_segment(&mut reader, &mut seg)? > 0 {
            let line = String::from_utf8_lossy(&seg).trim().to_string();
            if !line.is_empty() {
                collected.push_str(&line);
                collected.push('\n');
                let _ = channel.send(GitProgress { line });
            }
        }
    }
    let status = child
        .wait()
        .map_err(|e| GitError::Internal(format!("git 等待失败: {e}")))?;
    Ok((status.success(), collected))
}

/// 按 \r 或 \n 读一段（git 进度用 \r 刷新同一行，须二者皆为分隔才能流式更新）。返回读取字节数（0=EOF）。
fn read_segment<R: BufRead>(r: &mut R, buf: &mut Vec<u8>) -> Result<usize, GitError> {
    buf.clear();
    let mut total = 0usize;
    let mut byte = [0u8; 1];
    loop {
        let n = r
            .read(&mut byte)
            .map_err(|e| GitError::Internal(format!("读 git 输出失败: {e}")))?;
        if n == 0 {
            return Ok(total);
        }
        total += 1;
        if byte[0] == b'\r' || byte[0] == b'\n' {
            return Ok(total);
        }
        buf.push(byte[0]);
    }
}

/// stderr 末行（失败时给最有信息量的一行）。
fn last_line(s: &str) -> String {
    s.lines()
        .filter(|l| !l.trim().is_empty())
        .last()
        .unwrap_or("远程操作失败")
        .trim()
        .to_string()
}

/// 当前 HEAD oid（判 ff 前后是否变化）。
fn head_oid(repo: &str) -> Option<String> {
    Command::new("git")
        .current_dir(repo)
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// fetch（更新远程跟踪分支）。
#[tauri::command]
pub async fn git_fetch(
    repo_root: String,
    remote: String,
    channel: Channel<GitProgress>,
) -> Result<(), String> {
    super::blocking(move || {
        let (ok, err) = run_streamed(Some(&repo_root), &["fetch", "--progress", "--", &remote], &channel)?;
        if !ok {
            return Err(GitError::Git(format!("获取失败: {}", last_line(&err))));
        }
        Ok(())
    })
    .await
}

/// push 本地分支到远程同名分支。非快进（远程有新提交）→ git 拒绝并报错（不强推）。
#[tauri::command]
pub async fn git_push(
    repo_root: String,
    remote: String,
    branch: String,
    channel: Channel<GitProgress>,
) -> Result<(), String> {
    super::blocking(move || {
        let (ok, err) = run_streamed(
            Some(&repo_root),
            &["push", "--progress", "--", &remote, &branch],
            &channel,
        )?;
        if !ok {
            return Err(GitError::Git(format!(
                "推送失败（远程可能有新提交，先拉取）: {}",
                last_line(&err)
            )));
        }
        Ok(())
    })
    .await
}

/// pull = fetch + merge --ff-only。up-to-date/fast-forward 自动；分叉返回 Diverged（不自动产无签名 merge）。
#[tauri::command]
pub async fn git_pull(
    repo_root: String,
    remote: String,
    branch: String,
    channel: Channel<GitProgress>,
) -> Result<PullOutcome, String> {
    super::blocking(move || {
        let before = head_oid(&repo_root);
        let (ok, err) = run_streamed(
            Some(&repo_root),
            &["fetch", "--progress", "--", &remote, &branch],
            &channel,
        )?;
        if !ok {
            return Err(GitError::Git(format!("拉取（获取阶段）失败: {}", last_line(&err))));
        }
        // ff-only 合并 FETCH_HEAD：成功=ff/up-to-date（不丢工作区，冲突即拒绝），失败=分叉。
        let merged = Command::new("git")
            .current_dir(&repo_root)
            .args(["merge", "--ff-only", "FETCH_HEAD"])
            .output()
            .map_err(|e| GitError::Internal(format!("无法执行 git merge: {e}")))?;
        if !merged.status.success() {
            return Ok(PullOutcome::Diverged);
        }
        Ok(if before == head_oid(&repo_root) {
            PullOutcome::UpToDate
        } else {
            PullOutcome::FastForward
        })
    })
    .await
}

/// clone 到 dest 目录，返回 dest。
#[tauri::command]
pub async fn git_clone(
    url: String,
    dest: String,
    channel: Channel<GitProgress>,
) -> Result<String, String> {
    super::blocking(move || {
        let (ok, err) = run_streamed(None, &["clone", "--progress", "--", &url, &dest], &channel)?;
        if !ok {
            return Err(GitError::Git(format!("克隆失败: {}", last_line(&err))));
        }
        Ok(dest)
    })
    .await
}
