mod files;
mod git;
mod index;
mod path_guard;
mod vault;
mod watcher;
mod window_guard;
mod zotero;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // 前端只读 SQL 查询通道（Phase 4 FTS5 索引；写全在 Rust index 模块，capability 仅授 sql:default 只读集）。
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            vault::open_vault,
            vault::list_dir,
            vault::list_files,
            vault::find_repo_root,
            files::read_file,
            files::write_file_atomic,
            files::write_file_to_path,
            files::create_file,
            files::create_dir,
            files::rename_path,
            files::move_path,
            files::trash_path,
            watcher::start_watch,
            watcher::stop_watch,
            index::index_upsert_doc,
            index::index_remove_doc,
            index::index_rebuild,
            index::index_switch_vault,
            git::status::git_status,
            git::branch::git_branch_list,
            git::log::git_log,
            git::diff::git_diff,
            git::refs::git_refs,
            git::commit::git_commit,
            git::commit::git_merge,
            git::commit::git_cherry_pick,
            git::commit::git_revert,
            git::commit::git_abort_op,
            git::refops::git_checkout,
            git::refops::git_create_branch,
            git::refops::git_delete_branch,
            git::refops::git_reset,
            git::refops::git_tag_create,
            git::refops::git_tag_delete,
            git::stash::git_stash_save,
            git::stash::git_stash_pop,
            git::stash::git_stash_drop,
            git::stash::git_stash_list,
            git::remote::git_fetch,
            git::remote::git_push,
            git::remote::git_pull,
            git::remote::git_clone,
            git::auth::git_login_github,
            git::auth::git_logout_github,
            git::auth::git_github_status,
            git::pr::gh_pr_list,
            git::pr::gh_pr_create,
            git::pr::gh_pr_merge,
            zotero::zotero_cayw,
            zotero::zotero_citekeys,
            zotero::zotero_items
        ])
        .setup(|app| {
            // watcher 单例状态注册（切 vault 时 start/stop_watch 经此句柄换装）。
            watcher::init(app);
            // FTS5 索引单例：建有界写队列 + spawn 后台单写 worker（Phase 4 W1）。
            index::init(app);
            // D-04 离屏兜底：window-state 插件先于 setup 恢复几何，
            // 此处校验窗口与任一显示器相交，否则 center()
            if let Some(win) = app.get_webview_window("main") {
                window_guard::ensure_visible(&win);
                // Fixed-Version WebView2 下窗口会塌缩成 6x6（控制器异步附着时序）→ 强制复位尺寸/显示。
                window_guard::ensure_sized(&win);
                // 延迟重试：控制器可能在 setup 之后才附着并再次塌缩，800ms 后再强制一次。
                let win2 = win.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    window_guard::ensure_sized(&win2);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running InkStream");
}
