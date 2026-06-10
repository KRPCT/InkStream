mod window_guard;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
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
