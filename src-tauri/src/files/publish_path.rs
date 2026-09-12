use std::path::{Path, PathBuf};

/// Resolve the parent only: retain replacement of the named leaf, including a symlink.
/// MSIX may redirect a logical DOS directory to another volume; publication needs its physical parent.
pub(super) fn target(path: &Path) -> Result<PathBuf, String> {
    let leaf = path.file_name().ok_or("发布目标缺少文件名。")?;
    let parent = path.parent().filter(|parent| !parent.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    let parent = parent.canonicalize().map_err(|error| format!("无法解析发布目标目录：{error}"))?;
    Ok(parent.join(leaf))
}
