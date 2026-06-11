use crate::path_guard::canonicalize_in_root;
use std::path::Path;

/// 单次 invoke 负载红线阈值（字节）。
///
/// 超过此阈值的文件应改走 Channel 流式回传以避免阻塞 webview 主线程（RESEARCH
/// Open Question 3 / T-02-03）。本阶段 `read_file` 以普通 invoke 实现，Channel
/// 流式留待 02-03 出现真实大文件时落地——此处仅文档化红线判定阈值。
// 本阶段仅在 #[cfg(test)] 与文档中引用；02-03 接 Channel 时进入运行时路径。
#[allow(dead_code)]
pub const READ_FILE_INLINE_LIMIT_BYTES: u64 = 1_048_576;

/// 读取 vault 内某文件为 UTF-8 文本（路径经 path_guard 收口校验，T-02-01）。
///
/// `root` 为 vault 根绝对路径，`path` 为相对 vault 根的文件路径。返回文件全文。
/// 负载 > [`READ_FILE_INLINE_LIMIT_BYTES`]（1,048,576 字节 = 1MB）属红线：本阶段
/// 仍以普通 invoke 返回，02-03 接 Channel 流式（见常量文档）。
#[tauri::command]
pub fn read_file(root: String, path: String) -> Result<String, String> {
    let canon_root = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("无法解析工作区根: {e}"))?;
    let target = canonicalize_in_root(&canon_root, &path)?;
    std::fs::read_to_string(&target).map_err(|e| format!("无法读取文件: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{read_file, READ_FILE_INLINE_LIMIT_BYTES};
    use std::fs;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "inkstream-files-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&base).unwrap();
        base.canonicalize().unwrap()
    }

    #[test]
    fn red_line_threshold_is_one_megabyte() {
        assert_eq!(READ_FILE_INLINE_LIMIT_BYTES, 1_048_576);
    }

    #[test]
    fn read_file_returns_contents() {
        let root = temp_dir("read-ok");
        fs::write(root.join("note.md"), "墨流 hello").unwrap();
        let root_str = root.to_string_lossy().into_owned();
        let content = read_file(root_str, "note.md".to_string()).unwrap();
        assert_eq!(content, "墨流 hello");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_file_rejects_parent_escape() {
        let root = temp_dir("read-escape");
        let root_str = root.to_string_lossy().into_owned();
        let result = read_file(root_str, "../secret.txt".to_string());
        assert!(result.is_err());
        fs::remove_dir_all(&root).ok();
    }
}
