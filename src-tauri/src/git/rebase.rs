use super::{rebase_process::{run_process, ProcessOutput, ProcessSpec, StopReason}, rebase_registry, rebase_state, GitError};
pub use super::rebase_types::{RebaseAction, RebaseOutcome, RebaseResult, RebaseStatus};
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

pub(super) fn git_executable() -> Result<PathBuf, GitError> {
    let path = std::env::var_os("PATH").ok_or_else(|| GitError::Internal("PATH 未配置 Git".into()))?;
    let filename = if cfg!(windows) { "git.exe" } else { "git" };
    for directory in std::env::split_paths(&path).filter(|path| path.is_absolute()) {
        let executable = directory.join(filename);
        if executable.is_file() { return executable.canonicalize().map_err(|e| GitError::Internal(e.to_string())); }
    }
    Err(GitError::Internal("找不到系统 Git，请先安装 Git 并加入 PATH".into()))
}

pub(super) fn local_spec(repo: &git2::Repository, args: Vec<OsString>) -> Result<ProcessSpec, GitError> {
    let cwd = repo.workdir().ok_or_else(|| GitError::Git("裸仓库没有可修改的工作树".into()))?.canonicalize().map_err(|e| GitError::Git(e.to_string()))?;
    Ok(ProcessSpec {
        program: git_executable()?, cwd, args,
        env_remove: ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "INKSTREAM_GH_TOKEN", "INKSTREAM_GITHUB_TOKEN"].map(OsString::from).to_vec(),
        env_set: [("GIT_TERMINAL_PROMPT", "0"), ("GIT_EDITOR", "true"), ("GIT_SEQUENCE_EDITOR", "true")].map(|(key, value)| (key.into(), value.into())).to_vec(),
    })
}

fn failure(repo: &git2::Repository, error: String) -> Result<RebaseResult, GitError> {
    Ok(RebaseResult { outcome: RebaseOutcome::Failed, status: rebase_state::inspect(repo)?, error: Some(error) })
}

pub(super) fn execute(repo_root: &str, request_id: String, action: RebaseAction) -> Result<RebaseResult, GitError> {
    let repo = super::open_repo(repo_root)?;
    let lease = rebase_registry::acquire(&repo, request_id)?;
    let before = rebase_state::inspect(&repo)?;
    if lease.cancelled.load(Ordering::Acquire) {
        return Ok(RebaseResult { outcome: RebaseOutcome::Cancelled, status: before, error: None });
    }
    let mut args: Vec<OsString> = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(120);
    let aborting = matches!(action, RebaseAction::Abort);
    match action {
        RebaseAction::Start { upstream } => {
            if before.in_progress || repo.state() != git2::RepositoryState::Clean { return failure(&repo, "仓库已有未结束的 Git 操作".into()); }
            if !repo.head().is_ok_and(|head| head.is_branch()) { return failure(&repo, "请先切换到一个已有提交的本地分支".into()); }
            if upstream.trim().is_empty() { return failure(&repo, "请选择要变基到的分支或提交".into()); }
            let target = match repo.revparse_single(upstream.trim()).and_then(|object| object.peel_to_commit()) {
                Ok(commit) => commit.id().to_string(),
                Err(_) => return failure(&repo, "找不到要变基到的本地引用或提交".into()),
            };
            rebase_registry::remember_start(&repo, before.head_oid.clone(), Some(target.clone()))?;
            // Existing external sequences are continued unchanged; only application starts force signing.
            args.extend(["-c", "rebase.updateRefs=false", "rebase", "--merge", "--no-autostash", "--no-autosquash", "-S"].map(OsString::from));
            args.push(target.into());
        }
        RebaseAction::Continue | RebaseAction::Skip | RebaseAction::Abort => {
            if !before.in_progress { return failure(&repo, "没有正在进行的变基".into()); }
            args.push("rebase".into());
            args.push(match action { RebaseAction::Continue => "--continue", RebaseAction::Skip => "--skip", _ => "--abort" }.into());
        }
        RebaseAction::CommitContinue { commit } => {
            if !before.in_progress || !before.needs_commit || before.current_commit.as_deref() != Some(commit.as_str()) {
                return failure(&repo, "变基待提交状态已变化，未创建提交；请刷新后重试".into());
            }
            let oid = git2::Oid::from_str(&commit)?;
            repo.find_commit(oid)?;
            let mut commit_args = vec![OsString::from("commit"), OsString::from("--cleanup=verbatim"), OsString::from("-C"), OsString::from(oid.to_string())];
            if let Some(option) = rebase_state::recovery_signing_option(&repo)? { commit_args.push(option.into()); }
            let output = run_process(&local_spec(&repo, commit_args)?, &lease.cancelled, deadline.saturating_duration_since(Instant::now())).map_err(GitError::Git)?;
            if output.exit_code != Some(0) || output.interruption.is_some() || output.cleanup_error.is_some() {
                return finish(repo_root, output, false);
            }
            args.extend([OsString::from("rebase"), OsString::from("--continue")]);
        }
    }
    let spec = local_spec(&repo, args)?;
    let output = match run_process(&spec, &lease.cancelled, deadline.saturating_duration_since(Instant::now())) {
        Ok(output) => output,
        Err(error) => return failure(&super::open_repo(repo_root)?, error),
    };
    finish(repo_root, output, aborting)
}

fn finish(repo_root: &str, output: ProcessOutput, aborting: bool) -> Result<RebaseResult, GitError> {
    let latest_repo = super::open_repo(repo_root)?;
    let status = rebase_state::inspect(&latest_repo)?;
    if !status.in_progress { rebase_registry::forget_start(&latest_repo)?; }
    let cleanup_failed = output.cleanup_error.is_some();
    let error = output.cleanup_error.or_else(|| match output.interruption {
        Some(StopReason::TimedOut) => Some("Git 执行超过 120 秒，已停止；保留现有变基状态供恢复".into()),
        Some(StopReason::Cancelled) => Some("已停止执行，保留现有变基状态；继续或中止请使用对应操作".into()),
        None if output.exit_code != Some(0) => Some(if output.stderr.trim().is_empty() { output.stdout.trim().to_string() } else { output.stderr.trim().to_string() }),
        _ => None,
    });
    let outcome = if output.interruption == Some(StopReason::Cancelled) { RebaseOutcome::Cancelled }
        else if output.exit_code == Some(0) && error.is_none() {
            if status.in_progress { RebaseOutcome::Paused } else if aborting { RebaseOutcome::Aborted } else { RebaseOutcome::Completed }
        }
        else if status.in_progress && !status.conflicts.is_empty() && output.interruption.is_none() && !cleanup_failed { RebaseOutcome::Paused }
        else { RebaseOutcome::Failed };
    Ok(RebaseResult { outcome, status, error })
}

#[tauri::command]
pub async fn git_rebase(repo_root: String, request_id: String, action: RebaseAction) -> Result<RebaseResult, String> {
    super::blocking(move || execute(&repo_root, request_id, action)).await
}

#[tauri::command]
pub async fn git_rebase_status(repo_root: String) -> Result<RebaseStatus, String> {
    super::blocking(move || rebase_state::inspect(&super::open_repo(&repo_root)?)).await
}

#[tauri::command]
pub async fn git_cancel_rebase(repo_root: String, request_id: String) -> Result<bool, String> {
    super::blocking(move || rebase_registry::cancel(&super::open_repo(&repo_root)?, request_id)).await
}
