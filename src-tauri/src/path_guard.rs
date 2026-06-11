use std::path::{Path, PathBuf};

/// 路径校验纯函数（Security V12 / T-02-01）。
///
/// `target` 规范化后必须落在 `root`（已规范化的 vault 根）之内，否则视为越界。
/// 越界包含 `../` 逃逸、绝对路径指向 root 之外、符号链接逃逸（canonicalize 会
/// 解析符号链接到真实目标，逃逸目标若在 root 外则前缀断言失败）。
///
/// 入参 `root` 与 `target` 均应已经 `canonicalize`。本函数只做前缀断言，不触磁盘——
/// 便于纯逻辑单测；磁盘规范化由 `canonicalize_in_root` 负责。
pub fn is_within_root(root: &Path, target: &Path) -> bool {
    // root 自身视为合法（打开 vault 根目录本身）。
    target == root || target.starts_with(root)
}

/// 把相对路径 `rel`（相对 vault 根）解析为规范化绝对路径，并断言其落在 `root` 内。
///
/// 流程：root 先 canonicalize（解析符号链接与 `.`/`..`）；拼接 rel 后再 canonicalize；
/// 用 [`is_within_root`] 断言前缀。任一步失败返回人类可读错误字符串（经 IPC 回前端）。
///
/// 注意：canonicalize 要求目标存在。对"尚不存在的目标"（如新建文件预检）调用方应先
/// 规范化父目录再拼文件名——本阶段只读路径（list/read）目标均存在，后续写路径在 02-03 处理。
pub fn canonicalize_in_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("无法解析 vault 根路径: {e}"))?;
    let joined = canon_root.join(rel);
    let canon_target = joined
        .canonicalize()
        .map_err(|e| format!("无法解析目标路径: {e}"))?;
    if is_within_root(&canon_root, &canon_target) {
        Ok(canon_target)
    } else {
        Err("路径越出工作区根目录".to_string())
    }
}

/// 把"尚不存在的目标"（新建文件 / 写入新文件 / rename 目的地）解析为安全绝对路径。
///
/// canonicalize 要求目标存在，故对写路径改为：规范化目标**父目录**（须已存在）后拼文件名，
/// 再断言父目录落在 vault 根内。文件名段不得为 `..`/`.`/空（防经文件名段逃逸）。
///
/// 返回的路径未经 canonicalize（目标本不存在），但其父目录已 canonicalize 且在 root 内，
/// 故整体不越界。调用方据此 path 做 write/rename/create。
pub fn resolve_new_target_in_root(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let canon_root = root
        .canonicalize()
        .map_err(|e| format!("无法解析 vault 根路径: {e}"))?;
    let rel_path = Path::new(rel);
    let file_name = rel_path
        .file_name()
        .ok_or_else(|| "目标路径缺少文件名".to_string())?;
    let parent_rel = rel_path.parent().unwrap_or_else(|| Path::new(""));
    let canon_parent = canon_root
        .join(parent_rel)
        .canonicalize()
        .map_err(|e| format!("无法解析目标父目录: {e}"))?;
    if !is_within_root(&canon_root, &canon_parent) {
        return Err("路径越出工作区根目录".to_string());
    }
    Ok(canon_parent.join(file_name))
}

#[cfg(test)]
mod tests {
    use super::{is_within_root, resolve_new_target_in_root};
    use std::fs;
    use std::path::Path;

    /// 在 temp 下建唯一目录，返回其规范化路径。
    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir().join(format!(
            "inkstream-guard-{}-{}-{}",
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
    fn child_path_is_within_root() {
        let root = Path::new("/vault");
        assert!(is_within_root(root, Path::new("/vault/notes/a.md")));
    }

    #[test]
    fn resolve_new_target_rejects_dotdot_leaf() {
        // 叶子段为 `..` 须显式拒绝（不依赖 file_name() 返回 None 的隐式行为）。
        let root = temp_dir("leaf-dotdot");
        assert!(resolve_new_target_in_root(&root, "..").is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolve_new_target_rejects_dot_leaf() {
        // 叶子段为 `.` 须显式拒绝。
        let root = temp_dir("leaf-dot");
        assert!(resolve_new_target_in_root(&root, ".").is_err());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn resolve_new_target_allows_plain_leaf() {
        // 普通新建文件名（目标尚不存在）应被接受，落在 root 内。
        let root = temp_dir("leaf-plain");
        let resolved = resolve_new_target_in_root(&root, "note.md").unwrap();
        assert_eq!(resolved, root.join("note.md"));
        fs::remove_dir_all(&root).ok();
    }

    /// 符号链接叶子逃逸：当 root 内已存在指向 root 外的 symlink 叶子，
    /// resolve_new_target_in_root 须拒绝（否则后续 std::fs::write 跟随 symlink 写到 root 外）。
    ///
    /// symlink 创建需特权（Windows 非管理员不可用），故 cfg 门控：创建失败时优雅跳过。
    #[cfg(unix)]
    #[test]
    fn resolve_new_target_rejects_symlink_leaf_escaping_root() {
        let root = temp_dir("leaf-symlink-unix");
        let outside = temp_dir("leaf-symlink-unix-outside");
        let outside_target = outside.join("secret.txt");
        fs::write(&outside_target, "secret").unwrap();
        let link = root.join("evil.md");
        std::os::unix::fs::symlink(&outside_target, &link).unwrap();
        // 叶子是逃逸 symlink → 必须拒绝。
        assert!(resolve_new_target_in_root(&root, "evil.md").is_err());
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[cfg(windows)]
    #[test]
    fn resolve_new_target_rejects_symlink_leaf_escaping_root() {
        let root = temp_dir("leaf-symlink-win");
        let outside = temp_dir("leaf-symlink-win-outside");
        let outside_target = outside.join("secret.txt");
        fs::write(&outside_target, "secret").unwrap();
        let link = root.join("evil.md");
        // Windows 创建 symlink 需开发者模式/管理员；不可用时优雅跳过（不算失败）。
        match std::os::windows::fs::symlink_file(&outside_target, &link) {
            Ok(()) => {
                assert!(resolve_new_target_in_root(&root, "evil.md").is_err());
            }
            Err(_) => {
                eprintln!("跳过 symlink 测试：当前环境无 symlink 创建特权");
            }
        }
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn root_itself_is_within_root() {
        let root = Path::new("/vault");
        assert!(is_within_root(root, Path::new("/vault")));
    }

    #[test]
    fn parent_escape_is_rejected() {
        // canonicalize 后 `../etc` 会解析成 /etc，前缀不为 /vault
        let root = Path::new("/vault");
        assert!(!is_within_root(root, Path::new("/etc/passwd")));
    }

    #[test]
    fn absolute_outside_path_is_rejected() {
        let root = Path::new("/vault");
        assert!(!is_within_root(root, Path::new("/other/vault/a.md")));
    }

    #[test]
    fn sibling_with_shared_prefix_is_rejected() {
        // /vault-secret 与 /vault 共享字符串前缀但非子路径，starts_with 按路径分量比对应拒绝
        let root = Path::new("/vault");
        assert!(!is_within_root(root, Path::new("/vault-secret/a.md")));
    }
}
