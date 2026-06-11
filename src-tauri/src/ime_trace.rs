//! DEV-only IME 诊断追踪落盘通道（EDIT-06 真机定位工具）。
//!
//! 背景：WebView2 的 devtools Console 在真机偶发抓不到 `[IME-TRACE]` 输出（控制台缓冲 /
//! 焦点切走 / 组合期重绘竞态），导致中文 IME 吞字的「ground truth」时有时无。本模块把
//! 前端每条 trace 以单行追加到一个会话级临时文件，开发者可直接 `Get-Content -Wait` 离线读，
//! 不再依赖 Console 是否恰好捕获。
//!
//! 纪律：
//!   - 文件落在 `std::env::temp_dir()/inkstream-ime-trace.log`（跨平台临时目录，无 vault 越权）。
//!   - 每个 App 会话在 setup 钩子里 `truncate` 一次（清空），使每次启动从干净文件开始。
//!   - 命令 `ime_trace_append` 仅 `debug_assertions`（DEV / `tauri dev` / debug build）下真正写盘；
//!     release 构建编译为 no-op，零生产成本（与前端 `import.meta.env.DEV` 摇树对齐）。
//!   - 任一 IO 失败只回 `Err(String)` 供前端 catch 吞掉，绝不 panic、绝不阻塞输入。

use std::path::PathBuf;

/// 会话级 trace 文件绝对路径（`%TEMP%/inkstream-ime-trace.log`，跨平台临时目录）。
pub fn trace_file_path() -> PathBuf {
    std::env::temp_dir().join("inkstream-ime-trace.log")
}

/// App 启动时清空（truncate）trace 文件并把绝对路径打到 stdout，使其可被发现。
///
/// 仅 debug build 执行（与命令的 `debug_assertions` 写盘门对齐）；release 下整体 no-op。
/// 清空失败只打印告警，不阻断启动——诊断工具绝不拖垮主流程。
pub fn init_session() {
    #[cfg(debug_assertions)]
    {
        let path = trace_file_path();
        match std::fs::write(&path, b"") {
            Ok(()) => println!("[IME-TRACE] session log: {}", path.display()),
            Err(e) => eprintln!("[IME-TRACE] 无法清空 trace 文件 {}: {e}", path.display()),
        }
    }
}

/// 追加一行（`line + "\n"`）到会话 trace 文件。
///
/// 前端 DEV tracer fire-and-forget 调用，每条 trace 一行（已是扁平单行字符串）。
/// debug build 下以 append 模式打开并写入；release 下编译为 no-op（直接 `Ok(())`）。
#[tauri::command]
pub fn ime_trace_append(line: String) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        use std::io::Write;
        let path = trace_file_path();
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| format!("无法打开 IME trace 文件: {e}"))?;
        f.write_all(line.as_bytes())
            .and_then(|()| f.write_all(b"\n"))
            .map_err(|e| format!("无法写入 IME trace: {e}"))?;
    }
    // release：`line` 被忽略（debug 分支编译掉），保持 no-op 以零生产成本。
    let _ = &line;
    Ok(())
}
