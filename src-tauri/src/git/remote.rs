//! Git 传输：每次请求携带远程设置，Rust 按 Git 解析后的真实目标执行准入。
//! 使用系统 git 保留 OpenSSH 与签名配置；自定义 URL 只作用于本次操作，不修改仓库 remote。

use super::GitError;
use serde::Serialize;
use tauri::ipc::Channel;

#[path = "remote_policy.rs"]
mod policy;
#[path = "remote_runner.rs"]
mod runner;

pub use policy::RemoteOptions;

/// Git 在重定向/credential context 改变后会再次调用 helper；不能只校验最初的 remote URL。
/// 不读取/保存系统凭据，只在匹配 HTTPS github.com 默认端口的 get 请求中返回应用 token。
const CRED_HELPER: &str = r#"credential.helper=!f() {
  test "$1" = get || return 0
  protocol= host=
  while IFS= read -r line; do
    test -n "$line" || break
    case "$line" in protocol=*) protocol=${line#protocol=} ;; host=*) host=${line#host=} ;; esac
  done
  test "$protocol" = https || return 0
  case "$host" in
    [gG][iI][tT][hH][uU][bB].[cC][oO][mM]|[gG][iI][tT][hH][uU][bB].[cC][oO][mM]:443) ;;
    *) return 0 ;;
  esac
  test -n "$INKSTREAM_GH_TOKEN" || return 0
  printf '%s\n' 'username=x-access-token' "password=$INKSTREAM_GH_TOKEN"
}; f"#;

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

fn target_for(
    options: &RemoteOptions,
    repo: &str,
    remote: &str,
    push: bool,
) -> Result<policy::RemoteTarget, GitError> {
    options.ensure_enabled().map_err(GitError::Git)?;
    let urls = if options.is_custom() {
        Vec::new()
    } else {
        runner::remote_urls(repo, remote, push)?
    };
    options.for_remote(remote, &urls).map_err(GitError::Git)
}

#[tauri::command]
pub async fn git_fetch(
    repo_root: String,
    remote: String,
    options: RemoteOptions,
    channel: Channel<GitProgress>,
) -> Result<(), String> {
    super::blocking(move || {
        let target = target_for(&options, &repo_root, &remote, false)?;
        let (ok, err) = runner::run_streamed(
            Some(&repo_root), &["fetch", "--progress", "--", &target.argument], &target, &channel,
        )?;
        if !ok {
            return Err(GitError::Git(format!("获取失败: {}", runner::last_line(&err))));
        }
        Ok(())
    }).await
}

#[tauri::command]
pub async fn git_push(
    repo_root: String,
    remote: String,
    branch: String,
    options: RemoteOptions,
    channel: Channel<GitProgress>,
) -> Result<(), String> {
    super::blocking(move || {
        // pushurl / pushInsteadOf 可与 fetch URL 不同，必须检查全部实际推送地址。
        let target = target_for(&options, &repo_root, &remote, true)?;
        let (ok, err) = runner::run_streamed(
            Some(&repo_root), &["push", "--progress", "--", &target.argument, &branch], &target, &channel,
        )?;
        if !ok {
            return Err(GitError::Git(format!("推送失败: {}", runner::last_line(&err))));
        }
        Ok(())
    }).await
}

#[tauri::command]
pub async fn git_pull(
    repo_root: String,
    remote: String,
    branch: String,
    options: RemoteOptions,
    channel: Channel<GitProgress>,
) -> Result<PullOutcome, String> {
    super::blocking(move || {
        let target = target_for(&options, &repo_root, &remote, false)?;
        let before = runner::head_oid(&repo_root);
        let (ok, err) = runner::run_streamed(
            Some(&repo_root), &["fetch", "--progress", "--", &target.argument, &branch], &target, &channel,
        )?;
        if !ok {
            return Err(GitError::Git(format!("拉取（获取阶段）失败: {}", runner::last_line(&err))));
        }
        let merged = runner::local_output(&repo_root, &["merge", "--ff-only", "FETCH_HEAD"])?;
        if !merged.status.success() {
            return Ok(PullOutcome::Diverged);
        }
        Ok(if before == runner::head_oid(&repo_root) { PullOutcome::UpToDate } else { PullOutcome::FastForward })
    }).await
}

#[tauri::command]
pub async fn git_clone(
    url: String,
    dest: String,
    options: RemoteOptions,
    channel: Channel<GitProgress>,
) -> Result<String, String> {
    super::blocking(move || {
        let target = options.for_clone(&url).map_err(GitError::Git)?;
        let (ok, err) = runner::run_streamed(
            None, &["clone", "--progress", "--", &target.argument, &dest], &target, &channel,
        )?;
        if !ok {
            return Err(GitError::Git(format!("克隆失败: {}", runner::last_line(&err))));
        }
        Ok(dest)
    }).await
}
