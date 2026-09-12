//! 索引生命周期与命令：每个任务绑定工作区会话，真实 SQL 提交后才返回成功。
//! ProjectRepository is the sole owner of project IDs and application-local index locations.

use tauri::{AppHandle, Manager};
#[path = "index_db.rs"]
mod db;
#[path = "index_links.rs"]
mod links;
#[path = "index_file.rs"]
mod file;
#[path = "index_worker.rs"]
mod worker;
#[path = "index_storage.rs"]
mod storage;
pub use storage::IndexLocation;
use worker::{IndexState, Operation, Scope};

#[cfg(test)]
use links::extract_wiki_links;
#[cfg(test)]
#[path = "index_link_tests.rs"]
mod link_tests;
#[cfg(test)]
#[path = "index_actor_tests.rs"]
mod actor_tests;
#[cfg(test)]
#[path = "index_refresh_tests.rs"]
mod refresh_tests;
#[cfg(test)]
#[path = "index_storage_tests.rs"]
mod storage_tests;

pub fn init(app: &tauri::App) {
    let app_handle = app.handle().clone();
    app.manage(IndexState::start_with_resolver(std::sync::Arc::new(move |scope| {
        let repository = crate::projects::repository(&app_handle)?;
        storage::Storage::project(repository.as_ref(), scope)
    })));
}

#[tauri::command]
pub async fn index_upsert_doc(
    app: AppHandle, root: String, session_id: String, path: String, content: String, project_id: Option<String>,
) -> Result<(), String> {
    app.state::<IndexState>().submit(
        Scope::new(root, session_id)?.with_project(project_id), Operation::Upsert { path, content },
    ).await.map(|_| ())
}

#[tauri::command]
pub async fn index_refresh_file(
    app: AppHandle, root: String, session_id: String, path: String, project_id: Option<String>,
) -> Result<(), String> {
    app.state::<IndexState>().submit(
        Scope::new(root, session_id)?.with_project(project_id), Operation::Refresh { path },
    ).await.map(|_| ())
}

#[tauri::command]
pub async fn index_remove_doc(
    app: AppHandle, root: String, session_id: String, path: String, project_id: Option<String>,
) -> Result<(), String> {
    app.state::<IndexState>().submit(
        Scope::new(root, session_id)?.with_project(project_id), Operation::Remove { path },
    ).await.map(|_| ())
}

#[tauri::command]
pub async fn index_rebuild(app: AppHandle, root: String, session_id: String, project_id: Option<String>) -> Result<IndexLocation, String> {
    app.state::<IndexState>().submit(
        Scope::new(root, session_id)?.with_project(project_id), Operation::Prepare { rebuild: true },
    ).await?.ok_or_else(|| "索引准备没有返回本机数据库位置。".into())
}

/// 停用也携带原 scope；根目录已被移动/删除时仍可关闭此前拥有的连接。
#[tauri::command]
pub async fn index_switch_vault(
    app: AppHandle, root: String, session_id: String, enabled: bool, project_id: Option<String>,
) -> Result<Option<IndexLocation>, String> {
    let (scope, operation) = if enabled {
        (Scope::new(root, session_id)?.with_project(project_id), Operation::Prepare { rebuild: false })
    } else {
        (Scope::owned(root, session_id)?.with_project(project_id), Operation::Stop)
    };
    app.state::<IndexState>().submit(scope, operation).await
}
