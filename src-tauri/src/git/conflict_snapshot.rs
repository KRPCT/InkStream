use super::{conflict_markers, rebase_registry};
use crate::path_guard::canonicalize_in_root;
use git2::{Oid, Repository};
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use std::sync::{Arc, LazyLock};
use tokio::sync::Semaphore;

pub(crate) const MAX_BYTES: u64 = 100 * 1024 * 1024;
static SNAPSHOT_SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(4)));

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Stage { pub path: String, pub oid: String, pub byte_length: u64 }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub working_oid: String,
    pub stages: [Option<Stage>; 3],
    pub head_oid: Option<String>,
    pub operation: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot { pub baseline: Baseline, pub marker_error: Option<String>, pub conflict_count: usize }

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Part { Working, Base, Ours, Theirs }

fn target(repo: &Repository, path: &str) -> Result<PathBuf, String> {
    canonicalize_in_root(repo.workdir().ok_or("裸仓库没有冲突工作文件")?, path)
}

fn bytes(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = std::fs::File::open(path).map_err(|e| format!("无法读取冲突文件：{e}"))?;
    let before = file.metadata().map_err(|e| e.to_string())?;
    if !before.is_file() || before.len() > MAX_BYTES { return Err("冲突正文不是普通文件或超过 100MiB 完整读取上限。".into()); }
    let mut value = Vec::with_capacity(before.len() as usize);
    (&mut file).take(MAX_BYTES + 1).read_to_end(&mut value).map_err(|e| e.to_string())?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    if value.len() as u64 != before.len() || after.len() != before.len() || after.modified().ok() != before.modified().ok() {
        return Err("冲突文件在读取期间变化，请重新读取。".into());
    }
    std::str::from_utf8(&value).map_err(|_| "冲突文件不是有效 UTF-8 文本。")?;
    Ok(value)
}

fn baseline(repo: &Repository, path: &str, content: &[u8]) -> Result<Baseline, String> {
    let index = repo.index().map_err(|e| e.to_string())?;
    let mut stages = None;
    for conflict in index.conflicts().map_err(|e| e.to_string())? {
        let conflict = conflict.map_err(|e| e.to_string())?;
        let entries = [conflict.ancestor, conflict.our, conflict.their];
        if !entries.iter().flatten().any(|entry| entry.path == path.as_bytes()) { continue; }
        let mut values = [None, None, None];
        for (number, entry) in entries.into_iter().enumerate() {
            if let Some(entry) = entry {
                let (length, kind) = repo.odb().and_then(|db| db.read_header(entry.id)).map_err(|e| e.to_string())?;
                if kind != git2::ObjectType::Blob { return Err("此冲突不是文本文件，需使用外部 Git 工具解决。".into()); }
                values[number] = Some(Stage { path: String::from_utf8(entry.path).map_err(|_| "冲突路径不是有效 UTF-8")?, oid: entry.id.to_string(), byte_length: length as u64 });
            }
        }
        stages = Some(values);
        break;
    }
    let stages = stages.ok_or("该文件已不在 Git 冲突索引中，请刷新状态。")?;
    let operation = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD"].iter()
        .filter_map(|name| repo.revparse_single(name).ok().map(|object| format!("{name}={}", object.id())))
        .collect::<Vec<_>>().join(";");
    Ok(Baseline { working_oid: Oid::hash_object(git2::ObjectType::Blob, content).map_err(|e| e.to_string())?.to_string(),
        stages, head_oid: repo.head().ok().and_then(|head| head.target()).map(|oid| oid.to_string()), operation: format!("{:?};{operation}", repo.state()) })
}

fn inspect(root: &str, path: &str) -> Result<(Repository, PathBuf, Vec<u8>, Baseline), String> {
    let repo = super::open_repo(root).map_err(String::from)?;
    let target = target(&repo, path)?;
    let content = bytes(&target)?;
    let baseline = baseline(&repo, path, &content)?;
    Ok((repo, target, content, baseline))
}

pub(super) fn metadata(root: &str, path: &str) -> Result<Snapshot, String> {
    let (_, _, content, baseline) = inspect(root, path)?;
    let parsed = conflict_markers::validate(std::str::from_utf8(&content).unwrap());
    Ok(Snapshot { baseline, conflict_count: parsed.as_ref().copied().unwrap_or(0), marker_error: parsed.err() })
}

pub(super) fn legacy_read(root: &str, path: &str) -> Result<String, String> {
    let (_, _, content, _) = inspect(root, path)?;
    if content.len() > 1024 * 1024 { return Err("冲突正文超过 1MiB，请使用 Raw 完整读取通道。".into()); }
    let text = String::from_utf8(content).map_err(|e| e.to_string())?;
    if serde_json::to_vec(&text).map_err(|e| e.to_string())?.len() > 1024 * 1024 { return Err("冲突 JSON 回复超过 1MiB，请使用 Raw 通道。".into()); }
    Ok(text)
}

pub(crate) fn read(root: &str, path: &str, expected: &Baseline, part: Part) -> Result<Vec<u8>, String> {
    let (repo, _, content, actual) = inspect(root, path)?;
    if &actual != expected { return Err("冲突基线、索引或操作身份已变化，请重新读取。".into()); }
    let index = match part { Part::Working => return Ok(content), Part::Base => 0, Part::Ours => 1, Part::Theirs => 2 };
    let Some(stage) = &actual.stages[index] else { return Ok(Vec::new()); };
    if stage.byte_length > MAX_BYTES { return Err("冲突基线超过 100MiB 完整读取上限。".into()); }
    let blob = repo.find_blob(Oid::from_str(&stage.oid).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if blob.is_binary() || std::str::from_utf8(blob.content()).is_err() { return Err("冲突基线是二进制或非 UTF-8，无法显示文本。".into()); }
    Ok(blob.content().to_vec())
}

pub(crate) struct WriteGuard {
    root: String, path: String, expected: Baseline,
    lease: rebase_registry::Lease,
}
impl WriteGuard {
    pub(crate) fn begin(root: String, path: String, expected: Baseline, request_id: String) -> Result<(PathBuf, Self), String> {
        let repo = super::open_repo(&root).map_err(String::from)?;
        let lease = rebase_registry::acquire(&repo, request_id).map_err(String::from)?;
        let (_, target, content, actual) = inspect(&root, &path)?;
        if actual != expected { return Err("冲突文件或 Git 基线已变化，原文未修改。".into()); }
        conflict_markers::validate(std::str::from_utf8(&content).unwrap())?;
        Ok((target, Self { root, path, expected, lease }))
    }

    pub(crate) fn verify(&self, prepared: &Path) -> Result<(), String> {
        let resolved = bytes(prepared)?;
        self.verify_content(&resolved)
    }

    pub(super) fn verify_content(&self, resolved: &[u8]) -> Result<(), String> {
        let (_, _, content, actual) = inspect(&self.root, &self.path)?;
        if actual != self.expected { return Err("冲突文件或 Git 基线已变化，原文未修改。".into()); }
        conflict_markers::validate(std::str::from_utf8(&content).unwrap())?;
        if conflict_markers::validate(std::str::from_utf8(resolved).map_err(|_| "解决结果不是有效 UTF-8")?)? != 0 {
            return Err("解决结果仍有完整冲突标记，未写入/暂存。".into());
        }
        Ok(())
    }

    pub(crate) fn stage(&self, deadline: Instant) -> Result<(), String> {
        let repo = super::open_repo(&self.root).map_err(String::from)?;
        let spec = super::rebase::local_spec(&repo, ["add", "--", &self.path].map(std::ffi::OsString::from).to_vec()).map_err(String::from)?;
        let out = super::rebase_process::run_process(&spec, &self.lease.cancelled, deadline.saturating_duration_since(Instant::now()).min(Duration::from_secs(30)))?;
        if out.exit_code != Some(0) || out.interruption.is_some() || out.cleanup_error.is_some() {
            return Err(format!("正文已保存，但 Git 暂存未完成。请重新读取后重试：{}", out.cleanup_error.unwrap_or_else(|| if out.stderr.trim().is_empty() { "暂存被取消或超过期限".into() } else { out.stderr })));
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn git_conflict_snapshot(repo_root: String, path: String) -> Result<Snapshot, String> {
    let permit = SNAPSHOT_SLOTS.clone().try_acquire_owned().map_err(|_| "冲突读取正在忙，请稍后重试。")?;
    let worker = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit; // A slow OS read retains its slot even if the caller stops waiting.
        metadata(&repo_root, &path)
    });
    tokio::time::timeout(Duration::from_secs(15), worker).await
        .map_err(|_| "读取冲突基线超过 15 秒，未允许写入。")?
        .map_err(|error| format!("读取冲突基线任务失败：{error}"))?
}
