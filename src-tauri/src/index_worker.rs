use super::{db, file};
use sqlx::SqlitePool;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Scope {
    pub root: PathBuf,
    pub session_id: String,
}

impl Scope {
    pub fn owned(root: String, session_id: String) -> Result<Self, String> {
        if session_id.is_empty() || session_id.len() > 200 { return Err("索引会话标识无效".into()); }
        let root = PathBuf::from(root);
        if !root.is_absolute() { return Err("索引工作区必须是绝对路径".into()); }
        Ok(Self { root, session_id })
    }

    pub fn new(root: String, session_id: String) -> Result<Self, String> {
        if session_id.is_empty() || session_id.len() > 200 { return Err("索引会话标识无效".into()); }
        let root = Path::new(&root).canonicalize().map_err(|e| format!("索引工作区无效: {e}"))?;
        if !root.is_dir() { return Err("索引工作区不是目录".into()); }
        Ok(Self { root, session_id })
    }
}

pub(super) enum Operation {
    Prepare { rebuild: bool },
    Stop,
    Upsert { path: String, content: String },
    Refresh { path: String },
    Remove { path: String },
}

struct Pending {
    scope: Scope,
    operation: Operation,
    reply: oneshot::Sender<Result<(), String>>,
}

#[derive(Default)]
struct Admission {
    current: Option<Scope>,
    retired: HashSet<String>,
}

pub(super) struct IndexState {
    tx: mpsc::Sender<Pending>,
    admission: Arc<Mutex<Admission>>,
}

impl IndexState {
    pub fn start() -> Self {
        let (tx, rx) = mpsc::channel(1024);
        let admission = Arc::new(Mutex::new(Admission::default()));
        tauri::async_runtime::spawn(worker(rx, admission.clone()));
        Self { tx, admission }
    }

    pub async fn submit(&self, scope: Scope, operation: Operation) -> Result<(), String> {
        let (reply, response) = oneshot::channel();
        let preparing = matches!(operation, Operation::Prepare { .. });
        let stopping = matches!(operation, Operation::Stop);
        {
            let mut state = self.admission.lock().await;
            if !stopping && (state.retired.contains(&scope.session_id) || (!preparing && state.current.as_ref() != Some(&scope))) {
                return Err("索引工作区会话已过期或已停用".into());
            }
            self.tx.try_send(Pending { scope: scope.clone(), operation, reply })
                .map_err(|_| "索引队列繁忙或已关闭".to_string())?;
            if preparing && state.current.as_ref() != Some(&scope) {
                if let Some(previous) = state.current.replace(scope.clone()) { state.retired.insert(previous.session_id); }
            }
            if stopping {
                state.retired.insert(scope.session_id.clone());
                if state.current.as_ref() == Some(&scope) { state.current = None; }
            }
        }
        response.await.map_err(|_| "索引任务未完成，需重新准备索引".to_string())?
    }
}

fn current(state: &Admission, scope: &Scope) -> Result<(), String> {
    if state.current.as_ref() == Some(scope) && !state.retired.contains(&scope.session_id) { Ok(()) }
    else { Err("索引工作区会话已过期或已停用".into()) }
}

async fn worker(mut rx: mpsc::Receiver<Pending>, admission: Arc<Mutex<Admission>>) {
    let mut opened: Option<(Scope, SqlitePool)> = None;
    while let Some(job) = rx.recv().await {
        let result = execute(&mut opened, &admission, &job.scope, job.operation).await;
        let _ = job.reply.send(result); // Only SQL commit / completed close reaches the success reply.
    }
    if let Some((_, pool)) = opened { pool.close().await; }
}

async fn execute(
    opened: &mut Option<(Scope, SqlitePool)>, admission: &Mutex<Admission>, scope: &Scope, operation: Operation,
) -> Result<(), String> {
    if matches!(operation, Operation::Stop) {
        if opened.as_ref().is_some_and(|(owner, _)| owner == scope) {
            if let Some((_, pool)) = opened.take() { pool.close().await; }
        }
        return Ok(());
    }
    let guard = admission.lock().await;
    current(&guard, scope)?;
    if let Operation::Prepare { rebuild } = operation {
        if rebuild || opened.as_ref().is_none_or(|(owner, _)| owner != scope) {
            if let Some((_, pool)) = opened.take() { pool.close().await; }
            *opened = Some((scope.clone(), db::open(&scope.root).await?));
        }
        drop(guard);
        if rebuild { rebuild_scope(&opened.as_ref().unwrap().1, admission, scope).await?; }
        return Ok(());
    }
    let (_, pool) = opened.as_ref().filter(|(owner, _)| owner == scope).ok_or("索引尚未准备完成")?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    match operation {
        Operation::Upsert { path, content } => db::upsert(&mut tx, &db::relative_path(&path)?, &content).await?,
        Operation::Refresh { path } => {
            let root = scope.root.clone();
            let (path, content) = tauri::async_runtime::spawn_blocking(move || file::read_saved(&root, &path))
                .await.map_err(|error| format!("索引读取任务失败: {error}"))??;
            db::upsert(&mut tx, &path, &content).await?;
        }
        Operation::Remove { path } => db::remove(&mut tx, &db::relative_path(&path)?).await?,
        _ => unreachable!(),
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    // Keep admission locked through commit: a switch cannot accept a new owner before this write ends.
    drop(guard);
    Ok(())
}

async fn rebuild_scope(pool: &SqlitePool, admission: &Mutex<Admission>, scope: &Scope) -> Result<(), String> {
    let files = db::collect(&scope.root)?;
    let chunks = files.chunks(200).collect::<Vec<_>>();
    let empty = Vec::new();
    let batches: Vec<&[(String, PathBuf)]> = if chunks.is_empty() { vec![&empty] } else { chunks };
    for (number, batch) in batches.into_iter().enumerate() {
        let guard = admission.lock().await;
        current(&guard, scope)?;
        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
        if number == 0 {
            sqlx::query("DELETE FROM files").execute(&mut *tx).await.map_err(|e| e.to_string())?;
            sqlx::query("DELETE FROM links").execute(&mut *tx).await.map_err(|e| e.to_string())?;
        }
        for (path, abs) in batch {
            match std::fs::read_to_string(abs) {
                Ok(content) => db::upsert(&mut tx, path, &content).await?,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(format!("索引无法读取 {path}: {e}")),
            }
        }
        tx.commit().await.map_err(|e| e.to_string())?;
        drop(guard); // Let stop / switch retire this scope between bounded batches.
    }
    Ok(())
}
