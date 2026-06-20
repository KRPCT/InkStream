//! 文件导出：经系统已安装的 pandoc 转更多格式（odt/rtf/latex/epub/typst/org）。
//!
//! 零信任：不打包 pandoc（约 150MB），仅检测系统 PATH 上的 pandoc——与 git/gh CLI 同走 std::process::Command
//! （非 Tauri 插件，无需 capability）。注入安全（同 git/commit.rs）：参数按 argv 数组传，不经 shell；markdown 经
//! stdin 喂入（不拼进 argv，也不落临时文件），即使含元字符也无注入面。out_path 来自原生保存对话框（用户授权边界）。

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

/// 是否检测到系统 pandoc（探测，永不抛错——未装即 Ok(false)）。
#[tauri::command]
pub async fn pandoc_available() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| match Command::new("pandoc").arg("--version").output() {
        Ok(o) => o.status.success(),
        Err(_) => false,
    })
    .await
    .map_err(|e| format!("pandoc 探测失败: {e}"))
}

/// 目标格式白名单（防御性，虽 argv 无 shell 注入面）。
fn allowed(fmt: &str) -> bool {
    matches!(fmt, "odt" | "rtf" | "latex" | "epub" | "typst" | "org")
}

/// 经 pandoc 把 gfm markdown 转为 to_format 写到 out_path（绝对路径）。markdown 经 stdin 喂入；失败回传 pandoc stderr。
#[tauri::command]
pub async fn pandoc_convert(
    markdown: String,
    out_path: String,
    to_format: String,
) -> Result<(), String> {
    if !allowed(&to_format) {
        return Err(format!("不支持的导出格式: {to_format}"));
    }
    if !Path::new(&out_path).is_absolute() {
        return Err("导出路径必须是绝对路径".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = Command::new("pandoc")
            .args(["--from", "gfm", "--to", &to_format, "-o", &out_path])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    "未检测到 pandoc，请先安装 pandoc 再使用更多格式导出".to_string()
                } else {
                    format!("无法启动 pandoc: {e}")
                }
            })?;
        // 写 stdin 后立即丢弃 ChildStdin 关闭管道（否则 pandoc 等 EOF 不退出）。
        child
            .stdin
            .take()
            .ok_or_else(|| "无法写入 pandoc 输入".to_string())?
            .write_all(markdown.as_bytes())
            .map_err(|e| format!("写入 pandoc 失败: {e}"))?;
        let out = child
            .wait_with_output()
            .map_err(|e| format!("pandoc 执行失败: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&out.stderr);
        let t = stderr.trim();
        Err(if t.is_empty() {
            "pandoc 转换失败".to_string()
        } else {
            t.to_string()
        })
    })
    .await
    .map_err(|e| format!("pandoc 任务失败: {e}"))?
}
