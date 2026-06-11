mod files;
mod path_guard;
mod vault;
mod watcher;
mod window_guard;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            vault::open_vault,
            vault::list_dir,
            vault::find_repo_root,
            files::read_file,
            files::write_file_atomic,
            files::create_file,
            files::create_dir,
            files::rename_path,
            files::move_path,
            files::trash_path,
            watcher::start_watch,
            watcher::stop_watch
        ])
        .setup(|app| {
            // watcher 单例状态注册（切 vault 时 start/stop_watch 经此句柄换装）。
            watcher::init(app);
            // D-04 离屏兜底：window-state 插件先于 setup 恢复几何，
            // 此处校验窗口与任一显示器相交，否则 center()
            if let Some(win) = app.get_webview_window("main") {
                window_guard::ensure_visible(&win);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running InkStream");
}
