//! DEV-only IME 诊断追踪落盘通道（EDIT-06 真机定位工具）。
//!
//! 背景：WebView2 的 devtools Console 在真机偶发抓不到 `[IME-TRACE]` 输出（控制台缓冲 /
//! 焦点切走 / 组合期重绘竞态），导致中文 IME 吞字的「ground truth」时有时无。本模块把
//! 前端每条 trace 以单行追加到一个会话级临时文件，**并** println! 到 Rust 进程 stdout
//! （`pnpm tauri dev` 直接透出），开发者可任选 `Get-Content -Wait` 文件或 dev 控制台离线读，
//! 不再依赖 Console 是否恰好捕获，也不受 invoke 静默失败导致空文件的影响。
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
        // 命令注册存在性自证：若 webview→Rust 的 ime_trace_append invoke 静默失败，
        // 文件通道会空——这一行让 `pnpm tauri dev` 的 Rust stdout 至少确认命令已挂上 handler。
        println!("[IME-TRACE] ime_trace_append command registered");
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
        // 也 println! 到 Rust 进程 stdout：WebView2 的 devtools Console 与文件通道在真机
        // 都曾不可靠（缓冲 / 焦点切走 / invoke 静默失败导致空文件），而 `pnpm tauri dev`
        // 直接透出 Rust stdout——这是当前最可靠的离线读取通道（同时仍追加文件，双保险）。
        println!("{line}");
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
