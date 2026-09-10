use super::db;
use crate::path_guard::canonicalize_in_root;
use std::fs::File;
use std::io::Read;
use std::path::Path;

/// 与编辑器文本读取相同的容量边界；超过时明确失败，不把大文件当作空内容或略过。
const MAX_SAVED_FILE_BYTES: u64 = 100 * 1024 * 1024;

pub(super) fn read_saved(root: &Path, path: &str) -> Result<(String, String), String> {
    let relative = db::relative_path(path)?;
    let target = canonicalize_in_root(root, &relative)
        .map_err(|error| format!("索引无法读取 {relative}: {error}"))?;
    let mut file =
        File::open(target).map_err(|error| format!("索引无法读取 {relative}: {error}"))?;
    let before = file
        .metadata()
        .map_err(|error| format!("索引无法读取 {relative} 的文件信息: {error}"))?;
    if !before.is_file() {
        return Err(format!("索引目标 {relative} 不是普通文件"));
    }
    if before.len() > MAX_SAVED_FILE_BYTES {
        return Err(format!("索引文件 {relative} 超过100MiB读取上限"));
    }
    let modified = before.modified().ok();
    let mut content = String::with_capacity(before.len() as usize);
    (&mut file)
        .take(MAX_SAVED_FILE_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|error| format!("索引无法读取 {relative} 的UTF-8正文: {error}"))?;
    let after = file
        .metadata()
        .map_err(|error| format!("索引无法确认 {relative} 的读取结果: {error}"))?;
    if content.len() as u64 != before.len()
        || after.len() != before.len()
        || after.modified().ok() != modified
    {
        return Err(format!(
            "索引文件 {relative} 在读取期间改变，本次刷新未提交"
        ));
    }
    Ok((relative, content))
}
