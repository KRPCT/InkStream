//! Bounded metadata cache for already validated immutable checkpoint bodies.
use super::io;
use std::collections::HashMap;
use std::fs::{File, Metadata};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime};

const MAX_ENTRIES: usize = 512;
const MAX_PATH_BYTES: usize = 1024 * 1024;

#[derive(Clone, PartialEq, Eq)]
struct Fingerprint { length: u64, modified: SystemTime, identity: [u64; 4] }

#[cfg(unix)]
fn fingerprint(_file: &File, metadata: &Metadata) -> Option<Fingerprint> {
    use std::os::unix::fs::MetadataExt;
    Some(Fingerprint { length: metadata.len(), modified: metadata.modified().ok()?,
        identity: [metadata.dev(), metadata.ino(), metadata.ctime() as u64, metadata.ctime_nsec() as u64] })
}
#[cfg(windows)]
fn fingerprint(file: &File, metadata: &Metadata) -> Option<Fingerprint> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, GetFileInformationByHandleEx, FileBasicInfo, BY_HANDLE_FILE_INFORMATION, FILE_BASIC_INFO};
    let mut identity: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    let mut basic: FILE_BASIC_INFO = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut identity) } == 0
        || unsafe { GetFileInformationByHandleEx(file.as_raw_handle(), FileBasicInfo, (&mut basic as *mut FILE_BASIC_INFO).cast(), std::mem::size_of::<FILE_BASIC_INFO>() as u32) } == 0 { return None; }
    Some(Fingerprint { length: metadata.len(), modified: metadata.modified().ok()?, identity: [
        identity.dwVolumeSerialNumber as u64, ((identity.nFileIndexHigh as u64) << 32) | identity.nFileIndexLow as u64,
        basic.CreationTime as u64, basic.ChangeTime as u64,
    ] })
}
#[cfg(not(any(unix, windows)))]
fn fingerprint(_file: &File, _metadata: &Metadata) -> Option<Fingerprint> { None }

struct Entry { fingerprint: Fingerprint, units: u64, used: u64 }
#[derive(Default)]
pub(super) struct BodyCache {
    entries: HashMap<PathBuf, Entry>, path_bytes: usize, clock: u64,
    #[cfg(test)] scans: u64,
    #[cfg(test)] hits: u64,
}
fn deadline_check(deadline: Option<Instant>) -> Result<(), String> {
    if deadline.is_some_and(|deadline| Instant::now() >= deadline) { Err("项目快照超过 120 秒期限，旧会话保留。".into()) } else { Ok(()) }
}
impl BodyCache {
    fn remove(&mut self, path: &Path) -> Option<Entry> {
        let (stored, value) = self.entries.remove_entry(path)?;
        self.path_bytes -= stored.as_os_str().len();
        Some(value)
    }
    fn insert(&mut self, path: PathBuf, fingerprint: Fingerprint, units: u64) {
        self.remove(&path);
        let bytes = path.as_os_str().len();
        if bytes > MAX_PATH_BYTES { return; }
        while self.entries.len() >= MAX_ENTRIES || self.path_bytes + bytes > MAX_PATH_BYTES {
            let Some(oldest) = self.entries.iter().min_by_key(|(_, entry)| entry.used).map(|(path, _)| path.clone()) else { break; };
            self.remove(&oldest);
        }
        self.clock = self.clock.saturating_add(1); self.path_bytes += bytes;
        self.entries.insert(path, Entry { fingerprint, units, used: self.clock });
    }
    pub(super) fn length(&mut self, path: &Path, deadline: Option<Instant>, force: bool) -> Result<u64, String> {
        deadline_check(deadline)?;
        if !io::plain(path, false)? { self.remove(path); return Err(format!("快照正文缺失：{}", path.display())); }
        let mut file = File::open(path).map_err(|error| error.to_string())?;
        let before = file.metadata().map_err(|error| error.to_string())?;
        if before.len() > io::BODY_LIMIT { self.remove(path); return Err("单篇快照正文超过 100MiB。".into()); }
        let stamp = fingerprint(&file, &before);
        if !force {
            if let Some(entry) = self.entries.get_mut(path).filter(|entry| stamp.as_ref() == Some(&entry.fingerprint)) {
                deadline_check(deadline)?;
                self.clock = self.clock.saturating_add(1); entry.used = self.clock;
                #[cfg(test)] { self.hits += 1; }
                return Ok(entry.units);
            }
        }
        self.remove(path);
        #[cfg(test)] { self.scans += 1; }
        let units = io::body_length_opened(&mut file, &before, deadline)?;
        let after = file.metadata().map_err(|error| error.to_string())?;
        let after_stamp = fingerprint(&file, &after);
        if let (Some(before), Some(after)) = (&stamp, &after_stamp) {
            if before != after { return Err("正文身份或元数据在校验期间变化，未接受缓存或快照。".into()); }
            let current = File::open(path).map_err(|error| error.to_string())?;
            let current_metadata = current.metadata().map_err(|error| error.to_string())?;
            if fingerprint(&current, &current_metadata).as_ref() != Some(after) { return Err("正文路径在校验期间被替换，未接受快照。".into()); }
        }
        deadline_check(deadline)?;
        if let Some(stamp) = after_stamp { self.insert(path.to_owned(), stamp, units); }
        Ok(units)
    }
    /// Moving a whole owned directory usually leaves child identity/metadata intact.
    /// If the filesystem changes a stamp, simply revalidate that version on its next use.
    pub(super) fn publish(&mut self, stage: &Path, version: &Path) {
        let paths: Vec<_> = self.entries.keys().filter(|path| path.parent() == Some(stage)).cloned().collect();
        for old in paths {
            let Some(entry) = self.remove(&old) else { continue; };
            let Some(name) = old.file_name() else { continue; };
            let target = version.join(name);
            let stamp = File::open(&target).ok().and_then(|file| file.metadata().ok().and_then(|metadata| fingerprint(&file, &metadata)));
            if stamp.as_ref() == Some(&entry.fingerprint) { self.insert(target, entry.fingerprint, entry.units); }
        }
    }
    #[cfg(test)]
    pub(super) fn statistics(&self) -> (u64, u64, usize, usize) { (self.scans, self.hits, self.entries.len(), self.path_bytes) }
}
