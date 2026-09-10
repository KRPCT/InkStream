use super::{rebase_types::RebaseSource, GitError};
use git2::Repository;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc, Mutex, OnceLock};

struct Job { id: String, cancelled: Arc<AtomicBool> }
#[derive(Default)]
struct Registry {
    jobs: HashMap<PathBuf, Job>,
    retired: HashSet<(PathBuf, String)>,
    starts: HashMap<PathBuf, (Option<String>, Option<String>)>,
}
fn registry() -> &'static Mutex<Registry> { static STATE: OnceLock<Mutex<Registry>> = OnceLock::new(); STATE.get_or_init(|| Mutex::new(Registry::default())) }
fn key(repo: &Repository) -> Result<PathBuf, GitError> { repo.commondir().canonicalize().map_err(|e| GitError::Git(e.to_string())) }
fn worktree(repo: &Repository) -> Result<PathBuf, GitError> { repo.path().canonicalize().map_err(|e| GitError::Git(e.to_string())) }

pub(super) fn request_id() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!("native-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed))
}

pub(super) struct Lease { key: PathBuf, id: String, pub cancelled: Arc<AtomicBool> }
impl Drop for Lease {
    fn drop(&mut self) {
        if let Ok(mut state) = registry().lock() {
            if state.jobs.get(&self.key).is_some_and(|job| job.id == self.id) { state.jobs.remove(&self.key); }
            state.retired.insert((self.key.clone(), self.id.clone()));
        }
    }
}

pub(super) fn acquire(repo: &Repository, id: String) -> Result<Lease, GitError> {
    if id.is_empty() || id.len() > 200 { return Err(GitError::Git("Git 请求标识无效".into())); }
    let key = key(repo)?;
    let mut state = registry().lock().map_err(|_| GitError::Internal("Git 准入状态不可用".into()))?;
    if state.jobs.contains_key(&key) { return Err(GitError::Git("该仓库已有 Git 写操作正在执行".into())); }
    let cancelled = Arc::new(AtomicBool::new(state.retired.contains(&(key.clone(), id.clone()))));
    state.jobs.insert(key.clone(), Job { id: id.clone(), cancelled: cancelled.clone() });
    Ok(Lease { key, id, cancelled })
}

pub(super) fn cancel(repo: &Repository, id: String) -> Result<bool, GitError> {
    if id.is_empty() || id.len() > 200 { return Err(GitError::Git("Git 请求标识无效".into())); }
    let key = key(repo)?;
    let mut state = registry().lock().map_err(|_| GitError::Internal("Git 准入状态不可用".into()))?;
    if let Some(job) = state.jobs.get(&key).filter(|job| job.id == id) {
        job.cancelled.store(true, Ordering::Release);
        return Ok(true);
    }
    // Cancellation can arrive before the start command enters its blocking task.
    Ok(state.retired.insert((key, id)))
}

pub(super) fn remember_start(repo: &Repository, head: Option<String>, onto: Option<String>) -> Result<(), GitError> {
    let key = worktree(repo)?;
    registry().lock().map_err(|_| GitError::Internal("Git 准入状态不可用".into()))?.starts.insert(key, (head, onto));
    Ok(())
}

pub(super) fn forget_start(repo: &Repository) -> Result<(), GitError> {
    let key = worktree(repo)?;
    registry().lock().map_err(|_| GitError::Internal("Git 准入状态不可用".into()))?.starts.remove(&key);
    Ok(())
}

pub(super) fn source(repo: &Repository, active: bool, head: &Option<String>, onto: &Option<String>) -> Result<Option<RebaseSource>, GitError> {
    let key = worktree(repo)?;
    let common = repo.commondir().canonicalize().map_err(|e| GitError::Git(e.to_string()))?;
    let mut state = registry().lock().map_err(|_| GitError::Internal("Git 准入状态不可用".into()))?;
    if !active { if !state.jobs.contains_key(&common) { state.starts.remove(&key); } return Ok(None); }
    Ok(Some(if state.starts.get(&key).is_some_and(|pair| &pair.0 == head && &pair.1 == onto) { RebaseSource::Application } else { RebaseSource::Existing }))
}

/** Other application Git writers use the same common-directory lease. */
pub(super) fn lock_worktree(repo: &Repository) -> Result<Lease, GitError> {
    let lease = acquire(repo, request_id())?;
    if super::rebase_state::in_progress(repo) { return Err(GitError::Git("变基尚未结束，请先继续、跳过或中止变基".into())); }
    Ok(lease)
}
