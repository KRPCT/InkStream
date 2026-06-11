use crate::path_guard::{canonicalize_in_root, resolve_new_target_in_root};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

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

/// 同目录隐藏 temp 文件名（A5：同卷 rename 才原子）。
///
/// 命名含 pid + 纳秒时间戳，避免并发写互撞；`.inkstream-tmp` 前缀使其默认隐藏并便于清理。
fn temp_sibling(target: &Path) -> PathBuf {
    let file = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_name = format!(".inkstream-tmp-{}-{}-{}", std::process::id(), nanos, file);
    target
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(tmp_name)
}

/// 原子写（T-02-07）：同目录 temp 文件 + rename。写中途崩溃只丢 temp，原文件不动。
///
/// 路径经 path_guard 校验落在 vault 根内（目标可不存在，故走 resolve_new_target_in_root）。
/// 写 temp 或 rename 任一步失败均清理 temp 文件再返回错误。
///
/// WR-04 持久性：temp 写入后 `sync_all()` 把数据块刷盘**再** rename，避免掉电后
/// rename 已记账而数据块未落致零长/截断。Unix 上额外 fsync 父目录 fd，确保 rename
/// 这条目录项本身持久化；Windows 无等价父目录 fsync API，temp 的 sync_all 已足够
/// （NTFS 元数据日志保证 rename 顺序），故平台差异化处理。
#[tauri::command]
pub fn write_file_atomic(root: String, path: String, content: String) -> Result<(), String> {
    let canon_root = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("无法解析工作区根: {e}"))?;
    let target = resolve_new_target_in_root(&canon_root, &path)?;
    let tmp = temp_sibling(&target);

    // temp 写入 + 数据块刷盘（sync_all）。任一步失败清理 temp 再返回。
    let write_result = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
        Ok(())
    })();
    if let Err(e) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("无法写入临时文件: {e}"));
    }

    if let Err(e) = std::fs::rename(&tmp, &target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("无法落盘（rename 失败）: {e}"));
    }

    // Unix：fsync 父目录 fd，使 rename 的目录项变更持久化（尽力而为，失败不回滚已落盘的数据）。
    #[cfg(unix)]
    {
        if let Some(parent) = target.parent() {
            if let Ok(dir) = std::fs::File::open(parent) {
                let _ = dir.sync_all();
            }
        }
    }

    Ok(())
}

/// 新建空文件：已存在则 Err，绝不覆盖（D-12 同名拒绝）。
///
/// WR-05：用 `create_new(true)` 原子创建——内核层保证「不存在才建、存在即 AlreadyExists」，
/// 消除 `exists()` 预检与 write 之间的 TOCTOU 窗口（并发/外部抢建不会被静默覆盖）。
#[tauri::command]
pub fn create_file(root: String, path: String) -> Result<(), String> {
    let canon_root = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("无法解析工作区根: {e}"))?;
    let target = resolve_new_target_in_root(&canon_root, &path)?;
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
    {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Err("同名文件已存在".to_string()),
        Err(e) => Err(format!("无法创建文件: {e}")),
    }
}

/// 新建目录：已存在则 Err（同名拒绝）。
///
/// WR-05：依赖 `create_dir` 自身的 AlreadyExists 错误而非 `exists()` 预检（消除 TOCTOU）。
#[tauri::command]
pub fn create_dir(root: String, path: String) -> Result<(), String> {
    let canon_root = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("无法解析工作区根: {e}"))?;
    let target = resolve_new_target_in_root(&canon_root, &path)?;
    match std::fs::create_dir(&target) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Err("同名目录已存在".to_string()),
        Err(e) => Err(format!("无法创建目录: {e}")),
    }
}

/// 重命名：源须存在且在 root 内；目的地已存在则 Err（绝不覆盖，D-12）。
#[tauri::command]
pub fn rename_path(root: String, from: String, to: String) -> Result<(), String> {
    let canon_root = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("无法解析工作区根: {e}"))?;
    let src = canonicalize_in_root(&canon_root, &from)?;
    let dst = resolve_new_target_in_root(&canon_root, &to)?;
    if dst.exists() {
        return Err("目标名称已存在".to_string());
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("无法重命名: {e}"))
}

/// 移动：与 rename 同语义（同根内移动），目的地已存在则 Err。
#[tauri::command]
pub fn move_path(root: String, from: String, to: String) -> Result<(), String> {
    let canon_root = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("无法解析工作区根: {e}"))?;
    let src = canonicalize_in_root(&canon_root, &from)?;
    let dst = resolve_new_target_in_root(&canon_root, &to)?;
    if dst.exists() {
        return Err("目标位置已存在同名项".to_string());
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("无法移动: {e}"))
}

/// 删除到系统回收站（D-09）：路径经 path_guard 校验后交 trash crate。
#[tauri::command]
pub fn trash_path(root: String, path: String) -> Result<(), String> {
    let canon_root = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("无法解析工作区根: {e}"))?;
    let target = canonicalize_in_root(&canon_root, &path)?;
    trash::delete(&target).map_err(|e| format!("无法移入回收站: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{
        create_dir, create_file, move_path, read_file, rename_path, temp_sibling, trash_path,
        write_file_atomic, READ_FILE_INLINE_LIMIT_BYTES,
    };
    use std::fs;
    use std::path::Path;

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

    #[test]
    fn temp_sibling_stays_in_target_dir() {
        // A5：temp 须与目标同目录（同卷）才能 rename 原子。
        let target = Path::new("/vault/sub/note.md");
        let tmp = temp_sibling(target);
        assert_eq!(tmp.parent(), target.parent());
        assert!(tmp
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with(".inkstream-tmp-"));
    }

    #[test]
    fn write_file_atomic_creates_then_overwrites() {
        let root = temp_dir("write-atomic");
        let root_str = root.to_string_lossy().into_owned();
        write_file_atomic(root_str.clone(), "doc.md".to_string(), "v1".to_string()).unwrap();
        assert_eq!(fs::read_to_string(root.join("doc.md")).unwrap(), "v1");
        // 再写覆盖既有文件（原子写允许覆盖自身，区别于 create 的同名拒绝）。
        write_file_atomic(root_str, "doc.md".to_string(), "v2 墨流".to_string()).unwrap();
        assert_eq!(fs::read_to_string(root.join("doc.md")).unwrap(), "v2 墨流");
        // 落盘后目录无残留 temp 文件（写成功路径不留 .inkstream-tmp）。
        let leftover = fs::read_dir(&root)
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().starts_with(".inkstream-tmp-"));
        assert!(!leftover, "原子写成功后不应残留 temp 文件");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_file_atomic_rejects_parent_escape() {
        let root = temp_dir("write-escape");
        let root_str = root.to_string_lossy().into_owned();
        // 父目录逃逸：../ 越出 vault 根，path_guard 拒绝。
        let result = write_file_atomic(root_str, "../evil.md".to_string(), "x".to_string());
        assert!(result.is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn create_file_rejects_same_name() {
        let root = temp_dir("create-dup");
        let root_str = root.to_string_lossy().into_owned();
        create_file(root_str.clone(), "a.md".to_string()).unwrap();
        // 已存在 → Err，绝不覆盖（D-12）。
        assert!(create_file(root_str, "a.md".to_string()).is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn create_file_never_truncates_existing_content() {
        // WR-05 TOCTOU：对已有内容的文件再 create_file 须 Err 且绝不清空既有内容
        // （create_new 原子创建，AlreadyExists 直接拒绝，无 exists()→write 竞态窗口）。
        let root = temp_dir("create-toctou");
        let root_str = root.to_string_lossy().into_owned();
        fs::write(root.join("a.md"), "重要内容").unwrap();
        assert!(create_file(root_str, "a.md".to_string()).is_err());
        // 既有内容必须原样保留（不得被空 write 覆盖）。
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "重要内容");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn create_dir_rejects_same_name() {
        let root = temp_dir("createdir-dup");
        let root_str = root.to_string_lossy().into_owned();
        create_dir(root_str.clone(), "sub".to_string()).unwrap();
        assert!(create_dir(root_str, "sub".to_string()).is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn rename_path_rejects_existing_target() {
        let root = temp_dir("rename-dup");
        let root_str = root.to_string_lossy().into_owned();
        fs::write(root.join("from.md"), "f").unwrap();
        fs::write(root.join("to.md"), "t").unwrap();
        // 目的地已存在 → Err，绝不覆盖目标内容。
        assert!(rename_path(root_str.clone(), "from.md".to_string(), "to.md".to_string()).is_err());
        // to.md 内容未被破坏。
        assert_eq!(fs::read_to_string(root.join("to.md")).unwrap(), "t");
        // 改名到新名字成功。
        rename_path(root_str, "from.md".to_string(), "renamed.md".to_string()).unwrap();
        assert!(root.join("renamed.md").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn move_path_rejects_existing_target() {
        let root = temp_dir("move-dup");
        let root_str = root.to_string_lossy().into_owned();
        fs::create_dir(root.join("dir")).unwrap();
        fs::write(root.join("x.md"), "x").unwrap();
        fs::write(root.join("dir").join("x.md"), "y").unwrap();
        // 移到已存在同名项 → Err。
        assert!(move_path(
            root_str.clone(),
            "x.md".to_string(),
            "dir/x.md".to_string()
        )
        .is_err());
        // 移到空位成功。
        move_path(root_str, "x.md".to_string(), "dir/moved.md".to_string()).unwrap();
        assert!(root.join("dir").join("moved.md").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn trash_path_rejects_parent_escape() {
        // 越界目标在校验阶段即被 path_guard 拒绝，绝不触达 trash::delete。
        let root = temp_dir("trash-escape");
        let root_str = root.to_string_lossy().into_owned();
        let result = trash_path(root_str, "../outside.md".to_string());
        assert!(result.is_err());
        fs::remove_dir_all(&root).ok();
    }
}
