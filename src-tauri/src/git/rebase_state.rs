use super::{rebase_registry, rebase_types::RebaseStatus, GitError};
use git2::Repository;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn state_dir(repo: &Repository) -> Option<PathBuf> {
    let merge = repo.path().join("rebase-merge");
    if merge.is_dir() { return Some(merge); }
    let apply = repo.path().join("rebase-apply");
    if apply.join("rebasing").is_file() { Some(apply) } else { None }
}
pub(super) fn in_progress(repo: &Repository) -> bool { state_dir(repo).is_some() }

/** Read the existing sequence's signing policy; never rewrite Git's private state. */
pub(super) fn recovery_signing_option(repo: &Repository) -> Result<Option<String>, GitError> {
    let directory = state_dir(repo).ok_or_else(|| GitError::Git("没有正在进行的变基".into()))?;
    match read(&directory.join("gpg_sign_opt"))? {
        Some(option) if option.starts_with("-S") && !option.contains(['\n', '\r', '\0']) => Ok(Some(option)),
        Some(_) => Err(GitError::Git("无法识别该变基序列的签名设置，未创建提交".into())),
        None if directory.ends_with("rebase-merge") => Ok(Some("--no-gpg-sign".into())),
        None => Ok(None), // The apply backend follows its normal commit configuration.
    }
}

fn read(path: &Path) -> Result<Option<String>, GitError> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text.trim().to_string()).filter(|value| !value.is_empty())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(GitError::Git(format!("无法读取变基状态：{error}"))),
    }
}
fn number(path: &Path) -> Result<Option<u32>, GitError> {
    read(path)?.map(|value| value.parse().map_err(|_| GitError::Git("变基进度文件无效".into()))).transpose()
}

fn rescheduled_pick(repo: &Repository, current: Option<&str>) -> Result<bool, GitError> {
    let Some(current) = current else { return Ok(false); };
    let Some(directory) = state_dir(repo) else { return Ok(false); };
    let Some(todo) = read(&directory.join("git-rebase-todo"))? else { return Ok(false); };
    let Some(line) = todo.lines().map(str::trim).find(|line| !line.is_empty() && !line.starts_with('#')) else { return Ok(false); };
    let mut fields = line.split_whitespace();
    if !matches!(fields.next(), Some("pick" | "p")) { return Ok(false); }
    Ok(fields.next().and_then(|oid| repo.revparse_single(oid).ok()).is_some_and(|object| object.id().to_string() == current))
}

pub(super) fn inspect(repo: &Repository) -> Result<RebaseStatus, GitError> {
    let directory = state_dir(repo);
    let head_oid = repo.head().ok().and_then(|head| head.target()).map(|oid| oid.to_string());
    let mut state = RebaseStatus {
        in_progress: directory.is_some(), head_oid,
        branch: repo.head().ok().filter(|head| head.is_branch()).and_then(|head| head.shorthand().ok().map(str::to_owned)),
        original_head: None, onto: None, current_commit: None, step: None, total: None,
        conflicts: Vec::new(), needs_commit: false, source: None,
    };
    if let Some(directory) = directory {
        state.original_head = read(&directory.join("orig-head"))?;
        state.onto = read(&directory.join("onto"))?;
        state.branch = read(&directory.join("head-name"))?.map(|name| name.strip_prefix("refs/heads/").unwrap_or(&name).to_string());
        state.current_commit = repo.revparse_single("REBASE_HEAD").ok().map(|object| object.id().to_string());
        if state.current_commit.is_none() { state.current_commit = read(&directory.join("stopped-sha"))?; }
        if state.current_commit.is_none() { state.current_commit = read(&directory.join("original-commit"))?; }
        if directory.ends_with("rebase-merge") {
            state.step = number(&directory.join("msgnum"))?;
            state.total = number(&directory.join("end"))?;
        } else {
            state.step = number(&directory.join("next"))?;
            state.total = number(&directory.join("last"))?;
        }
    }
    let index = repo.index()?;
    let mut paths = BTreeSet::new();
    for conflict in index.conflicts()? {
        let conflict = conflict?;
        for entry in [conflict.ancestor, conflict.our, conflict.their].into_iter().flatten() {
            paths.insert(String::from_utf8(entry.path).map_err(|_| GitError::Git("冲突路径不是有效 UTF-8".into()))?);
        }
    }
    state.conflicts = paths.into_iter().collect();
    // A failed signer can leave CHERRY_PICK_HEAD and stage the patch while re-queuing the same pick.
    // Git's normal continue rejects that staged state until the user explicitly commits the result.
    if state.in_progress && state.conflicts.is_empty() && rescheduled_pick(repo, state.current_commit.as_deref())? {
        let tree = repo.head()?.peel_to_tree()?;
        state.needs_commit = repo.diff_tree_to_index(Some(&tree), Some(&index), None)?.deltas().len() > 0;
    }
    state.source = rebase_registry::source(repo, state.in_progress, &state.original_head, &state.onto)?;
    Ok(state)
}
