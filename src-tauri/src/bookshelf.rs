use serde::Serialize;
use std::path::{Path, PathBuf};

/// 书架文件夹导入：读取用户选定文件夹的目录树（书→卷→章）。只读、不改盘。
///
/// 信任边界（同 read_file_bytes）：path 是用户经原生对话框显式选定的文件夹，仅接受绝对路径；
/// 只收录阅读支持的扩展名（txt/docx/epub/pdf），忽略点开头条目，深度封顶 3（书→卷→章），
/// 条目总数封顶，空目录剪除——杜绝越界读取与超大树撑爆 IPC。

/// 目录树节点（文件夹含 children；文件为叶子，children 空）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    /// 绝对路径。
    path: String,
    is_dir: bool,
    children: Vec<DirEntry>,
}

const TREE_MAX_DEPTH: usize = 3;
const TREE_MAX_ENTRIES: usize = 5000;

fn is_book_file(p: &Path) -> bool {
    matches!(
        p.extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .as_deref(),
        Some("txt" | "docx" | "epub" | "pdf")
    )
}

fn walk(dir: &Path, depth: usize, count: &mut usize) -> Result<DirEntry, String> {
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let mut children = Vec::new();
    if depth < TREE_MAX_DEPTH {
        let rd = std::fs::read_dir(dir).map_err(|e| format!("无法读取文件夹: {e}"))?;
        let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            if *count >= TREE_MAX_ENTRIES {
                break;
            }
            let fname = e.file_name().to_string_lossy().into_owned();
            if fname.starts_with('.') {
                continue;
            }
            // 跳过符号链接：防止 picked 文件夹内的 symlink 目录/文件逃逸出树、读取敏感文件
            // （file_type() 取自 DirEntry，不跟随链接，区别于 Path::is_dir/is_file）。
            let ft = match e.file_type() {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if ft.is_symlink() {
                continue;
            }
            let p = e.path();
            if ft.is_dir() {
                *count += 1;
                let sub = walk(&p, depth + 1, count)?;
                // 剪除空目录（无书籍文件、无非空子目录）。
                if !sub.children.is_empty() {
                    children.push(sub);
                }
            } else if ft.is_file() && is_book_file(&p) {
                *count += 1;
                children.push(DirEntry {
                    name: fname,
                    path: p.to_string_lossy().into_owned(),
                    is_dir: false,
                    children: Vec::new(),
                });
            }
        }
    }
    Ok(DirEntry {
        name,
        path: dir.to_string_lossy().into_owned(),
        is_dir: true,
        children,
    })
}

/// 读取绝对路径文件夹的书籍目录树（仅 txt/docx/epub/pdf + 子目录，深度封顶 3，空目录剪除）。
#[tauri::command]
pub fn list_dir_tree(path: String) -> Result<DirEntry, String> {
    let raw = PathBuf::from(&path);
    if !raw.is_absolute() {
        return Err("路径必须是绝对路径".to_string());
    }
    // 归一化 picked 根（解析根路径自身的 symlink）；配合 walk 内跳过 symlink，杜绝越界读取。
    let root = raw.canonicalize().map_err(|e| format!("无法解析文件夹: {e}"))?;
    if !root.is_dir() {
        return Err("所选路径不是文件夹".to_string());
    }
    let mut count = 0usize;
    walk(&root, 0, &mut count)
}

#[cfg(test)]
mod tests {
    use super::list_dir_tree;
    use std::fs;

    fn temp(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "inkstream-shelf-{}-{}-{}",
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
    fn rejects_relative_path() {
        assert!(list_dir_tree("rel/dir".to_string()).is_err());
    }

    #[test]
    fn collects_books_skips_dotfiles_and_nonbook() {
        let root = temp("collect");
        fs::write(root.join("第一卷.txt"), "x").unwrap();
        fs::write(root.join("readme.md"), "x").unwrap(); // 非书籍格式 → 不收
        fs::write(root.join(".hidden.txt"), "x").unwrap(); // 点开头 → 不收
        fs::create_dir(root.join("卷一")).unwrap();
        fs::write(root.join("卷一").join("第1章.epub"), "x").unwrap();
        fs::create_dir(root.join("空卷")).unwrap(); // 空目录 → 剪除
        let tree = list_dir_tree(root.to_string_lossy().into_owned()).unwrap();
        let names: Vec<&str> = tree.children.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"第一卷.txt"));
        assert!(names.contains(&"卷一"));
        assert!(!names.iter().any(|n| n.contains("readme")));
        assert!(!names.iter().any(|n| n.contains("hidden")));
        assert!(!names.iter().any(|n| *n == "空卷"));
        fs::remove_dir_all(&root).ok();
    }
}
