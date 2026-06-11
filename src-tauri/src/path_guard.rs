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

#[cfg(test)]
mod tests {
    use super::is_within_root;
    use std::path::Path;

    #[test]
    fn child_path_is_within_root() {
        let root = Path::new("/vault");
        assert!(is_within_root(root, Path::new("/vault/notes/a.md")));
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
