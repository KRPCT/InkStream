use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub(super) const JSON_LIMIT: usize = 1024 * 1024;
pub(super) const BODY_LIMIT: u64 = 100 * 1024 * 1024;
pub(super) const SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(super) fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
pub(super) fn nonce() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!("{}-{}-{}", now(), std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed))
}
pub(super) fn uuid(value: &str) -> Result<(), String> {
    if value.len() == 36 && value.bytes().enumerate().all(|(index, byte)| {
        if [8, 13, 18, 23].contains(&index) { byte == b'-' } else { byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) }
    }) { Ok(()) } else { Err("项目、快照和文档标识必须为小写 UUID。".into()) }
}
pub(super) fn text(value: &str, limit: usize, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().count() > limit || value.contains('\0') {
        Err(format!("{label}为空、过长或包含无效字符。"))
    } else { Ok(()) }
}
pub(super) fn display(path: &Path) -> Result<String, String> { path.to_str().map(str::to_owned).ok_or_else(|| "路径不是有效 Unicode。".into()) }
pub(super) fn canonical_directory(value: &str) -> Result<String, String> {
    let path = Path::new(value);
    if !path.is_absolute() { return Err("项目目录必须是绝对路径。".into()); }
    let path = path.canonicalize().map_err(|e| format!("无法打开项目目录：{e}"))?;
    if !path.is_dir() { return Err("项目路径不是文件夹。".into()); }
    display(&path)
}
pub(super) fn identity(value: &str) -> String {
    if cfg!(windows) { value.to_lowercase() } else { value.to_owned() }
}
pub(super) fn plain(path: &Path, directory: bool) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(value) if value.file_type().is_symlink() || (directory && !value.is_dir()) || (!directory && !value.is_file()) => Err(format!("受管理路径不是预期的普通{}：{}", if directory { "目录" } else { "文件" }, path.display())),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("无法检查受管理路径：{error}")),
    }
}
pub(super) fn ensure_directory(path: &Path) -> Result<(), String> {
    if plain(path, true)? { return Ok(()); }
    #[cfg(unix)]
    let builder = { use std::os::unix::fs::DirBuilderExt; let mut builder = fs::DirBuilder::new(); builder.mode(0o700); builder };
    #[cfg(not(unix))]
    let builder = fs::DirBuilder::new();
    builder.create(path).map_err(|e| format!("无法建立本机项目目录：{e}"))
}
pub(super) fn directory_chain(base: &Path, parts: &[&str]) -> Result<PathBuf, String> {
    let mut path = base.to_path_buf();
    for part in parts { path.push(part); ensure_directory(&path)?; }
    Ok(path)
}
pub(super) fn relative(root: &Path, value: &str) -> Result<PathBuf, String> {
    if !plain(root, true)? { return Err("会话根目录缺失。".into()); }
    let path = Path::new(value);
    if value.is_empty() || value.contains('\\') || path.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err("会话正文路径必须位于当前项目的受管理目录。".into());
    }
    let mut target = root.to_path_buf();
    let components: Vec<_> = path.components().collect();
    for (index, part) in components.iter().enumerate() {
        target.push(part.as_os_str());
        if !plain(&target, index + 1 < components.len())? { return Err(format!("会话正文或目录缺失：{value}")); }
    }
    Ok(target)
}
pub(super) fn existing_directory(root: &Path, directory: &Path) -> Result<bool, String> {
    if !plain(root, true)? { return Ok(false); }
    let relative = directory.strip_prefix(root).map_err(|_| "目录不属于本机项目存储。")?;
    let mut path = root.to_path_buf();
    for component in relative.components() {
        if !matches!(component, Component::Normal(_)) { return Err("本机目录路径无效。".into()); }
        path.push(component.as_os_str());
        if !plain(&path, true)? { return Ok(false); }
    }
    Ok(true)
}
pub(super) fn read(path: &Path, limit: usize) -> Result<Option<Vec<u8>>, String> {
    if !plain(path, false)? { return Ok(None); }
    let file = File::open(path).map_err(|e| e.to_string())?;
    let before = file.metadata().map_err(|e| e.to_string())?;
    if before.len() > limit as u64 { return Err(format!("文件超过 {} 字节读取预算：{}", limit, path.display())); }
    let mut value = Vec::with_capacity(before.len() as usize);
    file.take(limit as u64 + 1).read_to_end(&mut value).map_err(|e| e.to_string())?;
    if value.len() > limit || value.len() as u64 != before.len() { return Err("文件在读取期间改变，未接受不完整结果。".into()); }
    Ok(Some(value))
}
pub(super) fn json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    read(path, JSON_LIMIT)?.map(|bytes| serde_json::from_slice(&bytes).map_err(|error| format!("本机项目数据损坏或版本不受支持，原件已保留（{}）：{error}", path.display()))).transpose()
}
pub(super) fn encoded<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() > JSON_LIMIT { return Err("项目元数据超过 1MiB，未写入。".into()); }
    Ok(bytes)
}
pub(super) fn atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    plain(path, false)?;
    crate::files::write_atomic_bytes(path, &encoded(value)?)
}
pub(super) fn preserve(path: &Path) -> Result<(), String> {
    if !plain(path, false)? { return Ok(()); }
    let physical = path.canonicalize().map_err(|e| format!("无法解析要保留的原件：{e}"))?;
    let target = physical.with_file_name(format!("{}.preserved-{}", path.file_name().unwrap().to_string_lossy(), nonce()));
    // Atomic writes replace the inode, so a same-directory hard link preserves the
    // original even when corrupted metadata is too large to decode or copy in memory.
    fs::hard_link(&physical, &target).map_err(|e| format!("无法保留原件，未覆盖：{e}"))?;
    #[cfg(unix)] if let Some(parent) = path.parent() { File::open(parent).and_then(|file| file.sync_all()).map_err(|e| e.to_string())?; }
    Ok(())
}
pub(super) fn write_new(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| format!("无法创建独占本机文件：{e}"))?;
    file.write_all(bytes).and_then(|()| file.flush()).and_then(|()| file.sync_all()).map_err(|e| format!("本机文件写入失败：{e}"))
}
pub(super) fn body_length_opened(file: &mut File, before: &fs::Metadata, deadline: Option<Instant>) -> Result<u64, String> {
    if before.len() > BODY_LIMIT { return Err("单篇快照正文超过 100MiB。".into()); }
    let mut chunk = [0u8; 256 * 1024];
    let mut pending = Vec::with_capacity(chunk.len() + 3);
    let (mut bytes, mut units) = (0u64, 0u64);
    loop {
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) { return Err("项目快照超过 120 秒期限，旧会话保留。".into()); }
        let count = file.read(&mut chunk).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        bytes += count as u64;
        if bytes > before.len() || bytes > BODY_LIMIT { return Err("快照正文在校验时增长，未提交。".into()); }
        pending.extend_from_slice(&chunk[..count]);
        let valid = match std::str::from_utf8(&pending) {
            Ok(_) => pending.len(),
            Err(error) if error.error_len().is_none() => error.valid_up_to(),
            Err(_) => return Err("快照正文不是有效 UTF-8。".into()),
        };
        units += std::str::from_utf8(&pending[..valid]).unwrap().encode_utf16().count() as u64;
        pending.drain(..valid);
    }
    let after = file.metadata().map_err(|e| e.to_string())?;
    if !pending.is_empty() || bytes != before.len() || after.len() != before.len() || after.modified().ok() != before.modified().ok() {
        return Err("快照正文不完整或在校验时变化，未提交。".into());
    }
    Ok(units)
}
