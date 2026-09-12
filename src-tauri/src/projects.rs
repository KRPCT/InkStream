//! Application-local project catalog and transactional immutable document checkpoints.
mod catalog;
mod body_cache;
mod io;
mod session;
pub(crate) mod types;
#[cfg(test)] mod tests;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::Instant;
use tauri::{AppHandle, Manager};
pub use types::{ProjectCatalog, ProjectRecord, Snapshot, StoredSession, Ticket};

struct Lease { ownership: types::Ownership, started: Instant }
#[derive(Default)] struct State { leases: HashMap<String, Lease> }
pub(crate) struct ProjectRepository { app_data: PathBuf, root: PathBuf, state: Mutex<State>, body_cache: Mutex<body_cache::BodyCache> }

impl ProjectRepository {
    pub(crate) fn new(app_data: PathBuf) -> Self { Self { root: app_data.join("projects"), app_data, state: Mutex::new(State::default()), body_cache: Mutex::new(body_cache::BodyCache::default()) } }
    fn body_length(&self, path: &std::path::Path, deadline: Option<Instant>, force: bool) -> Result<u64, String> {
        self.body_cache.lock().map_err(|_| "正文校验缓存状态不可用，未写入。")?.length(path, deadline, force)
    }
    fn lock(&self) -> Result<MutexGuard<'_, State>, String> { self.state.lock().map_err(|_| "本机项目存储状态不可用，未写入。".into()) }
    fn ensure(&self) -> Result<(), String> {
        if !self.app_data.is_absolute() { return Err("应用数据目录必须为绝对路径。".into()); }
        std::fs::create_dir_all(&self.app_data).map_err(|e| format!("无法创建应用数据目录：{e}"))?;
        io::plain(&self.app_data, true)?;
        io::ensure_directory(&self.root)
    }
}

static STORES: LazyLock<Mutex<HashMap<PathBuf, Arc<ProjectRepository>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
pub(crate) fn repository(app: &AppHandle) -> Result<Arc<ProjectRepository>, String> {
    let data = app.path().app_data_dir().map_err(|e| format!("无法解析应用数据目录：{e}"))?;
    let mut stores = STORES.lock().map_err(|_| "本机项目存储注册表不可用。")?;
    Ok(stores.entry(data.clone()).or_insert_with(|| Arc::new(ProjectRepository::new(data))).clone())
}
async fn blocking<T: Send + 'static>(app: AppHandle, action: impl FnOnce(&ProjectRepository) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let repository = repository(&app)?;
    tauri::async_runtime::spawn_blocking(move || action(&repository)).await.map_err(|e| format!("本机项目存储任务失败：{e}"))?
}

#[tauri::command]
pub async fn project_catalog_get(app: AppHandle) -> Result<ProjectCatalog, String> { blocking(app, |store| store.catalog_get()).await }
#[tauri::command]
pub async fn project_register(app: AppHandle, id: String, root: String, name: String) -> Result<ProjectRecord, String> { blocking(app, move |store| store.register(id, root, name)).await }
#[tauri::command]
pub async fn project_update(app: AppHandle, id: String, name: Option<String>, favorite: Option<bool>) -> Result<ProjectRecord, String> { blocking(app, move |store| store.update(id, name, favorite)).await }
#[tauri::command]
pub async fn project_relocate(app: AppHandle, id: String, root: String) -> Result<ProjectRecord, String> { blocking(app, move |store| store.relocate(id, root)).await }
#[tauri::command]
pub async fn project_remove(app: AppHandle, id: String) -> Result<ProjectCatalog, String> { blocking(app, move |store| store.remove(id)).await }
#[tauri::command]
pub async fn project_activate(app: AppHandle, id: Option<String>) -> Result<ProjectCatalog, String> { blocking(app, move |store| store.activate(id)).await }
#[tauri::command]
pub async fn project_import_cover(app: AppHandle, id: String, path: String) -> Result<ProjectRecord, String> { blocking(app, move |store| store.import_cover(id, path)).await }
#[tauri::command]
pub async fn project_session_read(app: AppHandle, id: Option<String>) -> Result<StoredSession, String> { blocking(app, move |store| store.session_read(id)).await }
#[tauri::command]
pub async fn project_session_begin(window: tauri::WebviewWindow, app: AppHandle, id: Option<String>, token: String, expected_revision: u64, keys: Vec<String>) -> Result<Ticket, String> {
    let owner = window.label().to_string();
    blocking(app, move |store| store.session_begin(id, token, expected_revision, keys, owner)).await
}
#[tauri::command]
pub async fn project_session_commit(window: tauri::WebviewWindow, app: AppHandle, id: Option<String>, token: String, snapshot: Snapshot) -> Result<StoredSession, String> {
    let owner = window.label().to_string();
    blocking(app, move |store| store.session_commit(id, token, snapshot, &owner)).await
}
#[tauri::command]
pub async fn project_session_abort(window: tauri::WebviewWindow, app: AppHandle, id: Option<String>, token: String) -> Result<(), String> {
    let owner = window.label().to_string();
    blocking(app, move |store| store.session_abort(id, token, &owner)).await
}
#[tauri::command]
pub async fn project_restore_backup(app: AppHandle, id: Option<String>, kind: String) -> Result<(), String> { blocking(app, move |store| store.restore_backup(id, &kind)).await }

pub(crate) fn close_owner(app: &AppHandle, owner: &str) {
    let Ok(repository) = repository(app) else { return; };
    let owner = owner.to_owned();
    tauri::async_runtime::spawn_blocking(move || repository.close_owner(&owner));
}
