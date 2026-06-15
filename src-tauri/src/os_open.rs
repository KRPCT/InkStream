use tauri::{AppHandle, Emitter, Manager, State};

/// 冷启动「打开方式」：启动 argv 解析出的文件绝对路径，前端经 initial_open_file 取一次后清空（#6）。
pub struct InitialOpenFile(pub std::sync::Mutex<Option<String>>);

/// 从命令行参数里挑第一个存在的文件路径（跳过 argv[0]=exe 与 `-` 开头的 flag）。
/// 仅做存在性判定——扩展名过滤（.md/.markdown/.txt）由前端做，保持 Rust 侧简单。
pub fn file_from_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|a| !a.starts_with('-') && std::path::Path::new(a).is_file())
}

/// 冷启动「打开方式」：取启动时解析到的文件路径（消费一次，之后返回 None）。
#[tauri::command]
pub fn initial_open_file(state: State<'_, InitialOpenFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

/// 单实例第二次启动回调（#6）：聚焦/显示主窗 + 对解析到的文件发 `inkstream://open-file` 给前端路由。
pub fn handle_second_instance(app: &AppHandle, argv: Vec<String>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    if let Some(path) = file_from_args(argv) {
        let _ = app.emit("inkstream://open-file", path);
    }
}

#[cfg(test)]
mod tests {
    use super::file_from_args;
    use std::fs;

    #[test]
    fn picks_first_existing_file_skipping_exe_and_flags() {
        let f = std::env::temp_dir().join(format!(
            "inkstream-osopen-{}-{}.md",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&f, "x").unwrap();
        let fs_str = f.to_string_lossy().into_owned();
        let args = vec![
            "inkstream.exe".to_string(),
            "--flag".to_string(),
            fs_str.clone(),
            "alsoignored".to_string(),
        ];
        assert_eq!(file_from_args(args), Some(fs_str));
        fs::remove_file(&f).ok();
    }

    #[test]
    fn none_when_no_existing_file_arg() {
        let args = vec![
            "inkstream.exe".to_string(),
            "--flag".to_string(),
            "this-path-does-not-exist-xyz.md".to_string(),
        ];
        assert_eq!(file_from_args(args), None);
    }
}
