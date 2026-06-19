mod files;
mod git;
mod index;
mod os_open;
mod path_guard;
mod vault;
mod watcher;
mod window_guard;
mod zotero;
mod zotero_sync;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // #6：单实例——「打开方式」第二次启动时把 argv 转发给运行中的实例（聚焦 + 发 open-file 事件），
        // 而非另起一个 app 进程。须最先注册（第二实例检测早于其它 init）。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            os_open::handle_second_instance(app, argv);
        }))
        // #6：冷启动「打开方式」——启动 argv 解析到的文件路径存入管理态，前端经 initial_open_file 取一次。
        .manage(os_open::InitialOpenFile(std::sync::Mutex::new(
            os_open::file_from_args(std::env::args()),
        )))
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
            os_open::initial_open_file,
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
            git::pr::gh_pr_diff,
            git::pr::gh_pr_reviews,
            git::pr::gh_pr_review_create,
            git::pr::gh_issue_list,
            git::pr::gh_issue_create,
            git::pr::gh_comment_list,
            git::pr::gh_comment_create,
            git::auth::gh_cli_status,
            git::auth::git_login_github_gh,
            git::conflict::git_read_conflict,
            git::conflict::git_resolve_conflict,
            zotero::zotero_cayw,
            zotero::zotero_citekeys,
            zotero::zotero_items,
            zotero::zotero_csl,
            zotero_sync::zotero_set_credentials,
            zotero_sync::zotero_clear_credentials,
            zotero_sync::zotero_credentials_status,
            zotero_sync::zotero_sync,
            zotero_sync::zotero_cache_items,
            zotero_sync::zotero_cache_csl
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
