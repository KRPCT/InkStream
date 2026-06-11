use crate::path_guard::{canonicalize_in_root, is_within_root};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 打开 vault 的返回信息（前端 useVaultStore 消费）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    /// 规范化后的 vault 根绝对路径。
    pub root: String,
    /// 仓库根（向上找到的 .git 所在目录）；非 git 工作区为 None（D-05）。
    pub repo_root: Option<String>,
    /// vault 显示名（根目录文件名）。
    pub name: String,
}

/// 文件树单项（前端 TreeEntry 受控 data 的最小单元，D-11 排序由前端定）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeEntry {
    /// 条目名（文件/文件夹名，含点开头项；隐藏由前端 D-11 决定）。
    pub name: String,
    /// 相对 vault 根的路径（用 `/` 分隔，跨平台前端键值统一）。
    pub path: String,
    /// 是否为目录。
    pub is_dir: bool,
}

/// 纯 fs 向上找 `.git` 目录（Pitfall 7：本阶段不引 git2）。
///
/// 从 `start` 起逐级向上，遇到含 `.git` 项（目录或文件——worktree/submodule 的
/// `.git` 是文件）的目录即视为仓库根并返回；到达文件系统根仍未找到返回 None。
fn ascend_for_git(start: &Path) -> Option<PathBuf> {
    let mut cur = Some(start);
    while let Some(dir) = cur {
        if dir.join(".git").exists() {
            return Some(dir.to_path_buf());
        }
        cur = dir.parent();
    }
    None
}

/// 打开文件夹为 vault：规范化路径、探测仓库根、取显示名。
#[tauri::command]
pub fn open_vault(path: String) -> Result<VaultInfo, String> {
    let canon = Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("无法打开这个文件夹: {e}"))?;
    if !canon.is_dir() {
        return Err("选择的路径不是文件夹".to_string());
    }
    let repo_root = ascend_for_git(&canon).map(|p| p.to_string_lossy().into_owned());
    let name = canon
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| canon.to_string_lossy().into_owned());
    Ok(VaultInfo {
        root: canon.to_string_lossy().into_owned(),
        repo_root,
        name,
    })
}

/// 列出 vault 内某相对目录的直接子项（路径经 path_guard 收口校验，T-02-01）。
///
/// `root` 为 vault 根绝对路径，`rel` 为相对子目录（根目录传 ""）。每项 `path`
/// 以 vault 根为基的相对路径、`/` 分隔。点开头条目照常返回，隐藏交前端 D-11。
#[tauri::command]
pub fn list_dir(root: String, rel: String) -> Result<Vec<TreeEntry>, String> {
    let canon_root = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("无法解析工作区根: {e}"))?;
    let target = if rel.is_empty() {
        canon_root.clone()
    } else {
        canonicalize_in_root(&canon_root, &rel)?
    };
    // 双重保险：target 必须落在 root 内。
    if !is_within_root(&canon_root, &target) {
        return Err("路径越出工作区根目录".to_string());
    }
    let mut entries: Vec<TreeEntry> = Vec::new();
    for dirent in std::fs::read_dir(&target).map_err(|e| format!("无法读取目录: {e}"))? {
        let dirent = dirent.map_err(|e| format!("读取目录项失败: {e}"))?;
        let entry_path = dirent.path();
        let name = dirent.file_name().to_string_lossy().into_owned();
        let is_dir = dirent.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let rel_path = entry_path
            .strip_prefix(&canon_root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| name.clone());
        entries.push(TreeEntry {
            name,
            path: rel_path,
            is_dir,
        });
    }
    Ok(entries)
}

/// 从任意路径向上找仓库根（D-06 子目录场景；纯 fs，不引 git2）。
#[tauri::command]
pub fn find_repo_root(path: String) -> Result<Option<String>, String> {
    let canon = Path::new(&path)
        .canonicalize()
        .map_err(|e| format!("无法解析路径: {e}"))?;
    Ok(ascend_for_git(&canon).map(|p| p.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::{ascend_for_git, collect_files, list_dir, open_vault};
    use std::fs;

    /// 在 temp 下建唯一目录，返回其规范化路径。
    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "inkstream-test-{}-{}-{}",
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
    fn ascend_finds_git_in_self() {
        let root = temp_dir("git-self");
        fs::create_dir(root.join(".git")).unwrap();
        assert_eq!(ascend_for_git(&root).as_deref(), Some(root.as_path()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn ascend_finds_git_in_ancestor() {
        let root = temp_dir("git-ancestor");
        fs::create_dir(root.join(".git")).unwrap();
        let nested = root.join("a").join("b");
        fs::create_dir_all(&nested).unwrap();
        let nested_canon = nested.canonicalize().unwrap();
        assert_eq!(ascend_for_git(&nested_canon).as_deref(), Some(root.as_path()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn ascend_returns_none_without_git() {
        let root = temp_dir("no-git");
        assert!(ascend_for_git(&root).is_none());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn open_vault_reports_name_and_no_repo() {
        let root = temp_dir("open-vault");
        let info = open_vault(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(info.repo_root, None);
        assert!(!info.name.is_empty());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn list_dir_returns_children_with_relative_paths() {
        let root = temp_dir("list-dir");
        fs::write(root.join("a.md"), "x").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        let root_str = root.to_string_lossy().into_owned();
        let entries = list_dir(root_str, String::new()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"a.md"));
        assert!(names.contains(&"sub"));
        let sub = entries.iter().find(|e| e.name == "sub").unwrap();
        assert!(sub.is_dir);
        assert_eq!(sub.path, "sub");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn list_dir_rejects_parent_escape() {
        let root = temp_dir("list-escape");
        let root_str = root.to_string_lossy().into_owned();
        // rel 指向父级越界——canonicalize_in_root 应拒绝
        let result = list_dir(root_str, "..".to_string());
        assert!(result.is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn collect_files_enumerates_recursively() {
        let root = temp_dir("collect-recursive");
        fs::write(root.join("a.md"), "x").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub").join("b.md"), "y").unwrap();
        let mut out = Vec::new();
        collect_files(&root, &root, &mut out).unwrap();
        let paths: Vec<&str> = out.iter().map(|e| e.path.as_str()).collect();
        // 文件递归枚举（含子目录），不含目录本身
        assert!(paths.contains(&"a.md"));
        assert!(paths.contains(&"sub/b.md"));
        assert!(!paths.contains(&"sub"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn collect_files_skips_dot_directories() {
        let root = temp_dir("collect-dot");
        fs::write(root.join("keep.md"), "x").unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".git").join("config"), "ignored").unwrap();
        let mut out = Vec::new();
        collect_files(&root, &root, &mut out).unwrap();
        let paths: Vec<&str> = out.iter().map(|e| e.path.as_str()).collect();
        // 点开头目录（.git）整目录被跳过（D-11），其内文件不出现在清单
        assert!(paths.contains(&"keep.md"));
        assert!(!paths.iter().any(|p| p.starts_with(".git")));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn collect_files_paths_stay_within_root() {
        let root = temp_dir("collect-within");
        fs::write(root.join("a.md"), "x").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub").join("b.md"), "y").unwrap();
        let mut out = Vec::new();
        collect_files(&root, &root, &mut out).unwrap();
        // 每项相对路径都不含越界段（不以 ../ 开头、不为绝对路径）
        for entry in &out {
            assert!(!entry.path.starts_with("..") && !entry.path.starts_with('/'));
            // 每项绝对路径仍落在 root 内（path_guard 不变式）
            let abs = root.join(&entry.path);
            assert!(crate::path_guard::is_within_root(
                &root,
                &abs.canonicalize().unwrap()
            ));
        }
        fs::remove_dir_all(&root).ok();
    }
}
