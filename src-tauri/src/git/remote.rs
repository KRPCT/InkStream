//! 远程操作（Phase 6 W4 / GIT-06 + 簇④）：clone/fetch/push/pull 走**系统 git CLI（sidecar）**。
//!
//! 为何不用 git2/libssh2：实测 Windows 上 libgit2 vendored 的 libssh2（WinCNG backend）不支持 ed25519
//! 密钥（用户密钥即 ed25519），SSH 认证必失败；系统 git/OpenSSH 同密钥 clone 成功。系统 git 原生支持
//! ed25519 + ssh-agent + known_hosts，跨平台，且与 W3 commit 同走 git CLI 范式。
//!
//! HTTPS token 注入（簇④）：远程 URL 为 https:// 且已 GitHub 登录时，把 keyring 里的 token 经环境变量
//! INKSTREAM_GH_TOKEN + inline credential helper 临时注入——token 不入 argv（不进进程列表）、不写用户 GCM。
//! 进度：git --progress 写 stderr，逐段（\r/\n）经 tauri Channel 推前端。注入安全：argv 数组无 shell，远程/分支/url 前加 --。

use super::GitError;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

/// inline credential helper：git 调 "<helper> get" 时回显凭据（用户名 x-access-token，密码取自 env）。
const CRED_HELPER: &str = "credential.helper=!f() { if test \"$1\" = get; then echo username=x-access-token; echo \"password=${INKSTREAM_GH_TOKEN}\"; fi; }; f";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProgress {
    pub line: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PullOutcome {
    UpToDate,
    FastForward,
    Diverged,
}

/// 跑 git 远程子命令，stderr 进度逐段推 channel；token 经 env 注入（HTTPS 凭据）。返回 (success, stderr 全文)。
fn run_streamed(
    repo: Option<&str>,
    args: &[&str],
    token: Option<&str>,
    channel: &Channel<GitProgress>,
) -> Result<(bool, String), GitError> {
    let mut cmd = Command::new("git");
    if let Some(r) = repo {
        cmd.current_dir(r);
    }
    if let Some(t) = token {
        cmd.env("INKSTREAM_GH_TOKEN", t); // token 走 env，不入 argv
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

/// 按 \r 或 \n 读一段（git 进度用 \r 刷新同一行）。返回读取字节数（0=EOF）。
fn read_segment<R: BufRead>(r: &mut R, buf: &mut Vec<u8>) -> Result<usize, GitError> {
    buf.clear();
    let mut total = 0usize;
    let mut byte = [0u8; 1];
    loop {
        let n = std::io::Read::read(r, &mut byte)
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

fn last_line(s: &str) -> String {
    s.lines()
        .filter(|l| !l.trim().is_empty())
        .last()
        .unwrap_or("远程操作失败")
        .trim()
        .to_string()
}

fn head_oid(repo: &str) -> Option<String> {
    Command::new("git")
        .current_dir(repo)
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// 取远程 URL（判 HTTPS 是否注入 token）。
fn remote_url(repo: &str, remote: &str) -> Option<String> {
    Command::new("git")
        .current_dir(repo)
        .args(["remote", "get-url", "--", remote])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// 该 URL 为 HTTPS 且已登录 → 返回 token（注入凭据）；否则 None（SSH/未登录走系统凭据）。
fn token_for(url: &str) -> Option<String> {
    if url.starts_with("https://") {
        super::auth::github_token()
    } else {
        None
    }
}

/// 组装带可选凭据 -c 前缀的 args（token 有则 git 子命令前加 -c CRED_HELPER）。
fn with_cred<'a>(token: &Option<String>, op: &[&'a str]) -> Vec<&'a str> {
    let mut v: Vec<&str> = Vec::new();
    if token.is_some() {
        v.push("-c");
        v.push(CRED_HELPER);
    }
    v.extend_from_slice(op);
    v
}

#[tauri::command]
pub async fn git_fetch(
    repo_root: String,
    remote: String,
    channel: Channel<GitProgress>,
) -> Result<(), String> {
    super::blocking(move || {
        let token = remote_url(&repo_root, &remote).and_then(|u| token_for(&u));
        let args = with_cred(&token, &["fetch", "--progress", "--", &remote]);
        let (ok, err) = run_streamed(Some(&repo_root), &args, token.as_deref(), &channel)?;
        if !ok {
            return Err(GitError::Git(format!("获取失败: {}", last_line(&err))));
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn git_push(
    repo_root: String,
    remote: String,
    branch: String,
    channel: Channel<GitProgress>,
) -> Result<(), String> {
    super::blocking(move || {
        let token = remote_url(&repo_root, &remote).and_then(|u| token_for(&u));
        let args = with_cred(&token, &["push", "--progress", "--", &remote, &branch]);
        let (ok, err) = run_streamed(Some(&repo_root), &args, token.as_deref(), &channel)?;
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

#[tauri::command]
pub async fn git_pull(
    repo_root: String,
    remote: String,
    branch: String,
    channel: Channel<GitProgress>,
) -> Result<PullOutcome, String> {
    super::blocking(move || {
        let before = head_oid(&repo_root);
        let token = remote_url(&repo_root, &remote).and_then(|u| token_for(&u));
        let args = with_cred(&token, &["fetch", "--progress", "--", &remote, &branch]);
        let (ok, err) = run_streamed(Some(&repo_root), &args, token.as_deref(), &channel)?;
        if !ok {
            return Err(GitError::Git(format!("拉取（获取阶段）失败: {}", last_line(&err))));
        }
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

#[tauri::command]
pub async fn git_clone(
    url: String,
    dest: String,
    channel: Channel<GitProgress>,
) -> Result<String, String> {
    super::blocking(move || {
        let token = token_for(&url);
        let args = with_cred(&token, &["clone", "--progress", "--", &url, &dest]);
        let (ok, err) = run_streamed(None, &args, token.as_deref(), &channel)?;
        if !ok {
            return Err(GitError::Git(format!("克隆失败: {}", last_line(&err))));
        }
        Ok(dest)
    })
    .await
}
