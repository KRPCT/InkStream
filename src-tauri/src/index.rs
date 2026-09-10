//! 索引生命周期与命令：每个任务绑定工作区会话，真实 SQL 提交后才返回成功。
//! 数据仍在 <vault>/.inkstream/index.db；本次不执行本机索引目录迁移。

use tauri::{AppHandle, Manager};
#[path = "index_db.rs"]
mod db;
#[path = "index_links.rs"]
mod links;
#[path = "index_file.rs"]
mod file;
#[path = "index_worker.rs"]
mod worker;
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

pub fn init(app: &tauri::App) {
    app.manage(IndexState::start());
}

#[tauri::command]
pub async fn index_upsert_doc(
    app: AppHandle, root: String, session_id: String, path: String, content: String,
) -> Result<(), String> {
    app.state::<IndexState>().submit(
        Scope::new(root, session_id)?, Operation::Upsert { path, content },
    ).await
}

#[tauri::command]
pub async fn index_refresh_file(
    app: AppHandle, root: String, session_id: String, path: String,
) -> Result<(), String> {
    app.state::<IndexState>().submit(
        Scope::new(root, session_id)?, Operation::Refresh { path },
    ).await
}

#[tauri::command]
pub async fn index_remove_doc(
    app: AppHandle, root: String, session_id: String, path: String,
) -> Result<(), String> {
    app.state::<IndexState>().submit(
        Scope::new(root, session_id)?, Operation::Remove { path },
    ).await
}

#[tauri::command]
pub async fn index_rebuild(app: AppHandle, root: String, session_id: String) -> Result<(), String> {
    app.state::<IndexState>().submit(
        Scope::new(root, session_id)?, Operation::Prepare { rebuild: true },
    ).await
}

/// 停用也携带原 scope；根目录已被移动/删除时仍可关闭此前拥有的连接。
#[tauri::command]
pub async fn index_switch_vault(
    app: AppHandle, root: String, session_id: String, enabled: bool,
) -> Result<(), String> {
    let (scope, operation) = if enabled {
        (Scope::new(root, session_id)?, Operation::Prepare { rebuild: false })
    } else {
        (Scope::owned(root, session_id)?, Operation::Stop)
    };
    app.state::<IndexState>().submit(scope, operation).await
}
