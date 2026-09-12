use super::staged_write::StagedWrite;
use super::stream::Utf8Validator;
use crate::path_guard::resolve_new_target_in_root;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{mpsc, Arc, LazyLock, Mutex, Weak};
use std::time::{Duration, Instant};
use tauri::ipc::{InvokeBody, Request};
use tokio::sync::oneshot;

const CHUNK_BYTES: usize = 256 * 1024;
const MAX_METADATA_BYTES: usize = 256 * 1024;
const LIVE: u8 = 0;
const CANCELLED: u8 = 1;
const PUBLISHING: u8 = 2;
const DONE: u8 = 3;
const ID_HEADER: &str = "x-inkstream-write-id";
const OFFSET_HEADER: &str = "x-inkstream-write-offset";
static SESSIONS: LazyLock<Arc<WriteSessions>> =
    LazyLock::new(|| Arc::new(WriteSessions::new(Limits::default())));

#[derive(Clone, Copy)]
pub(super) struct Limits {
    pub maximum: usize,
    pub total: Duration,
    pub idle: Duration,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            maximum: 4,
            total: Duration::from_secs(120),
            idle: Duration::from_secs(15),
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Target {
    Vault { root: String, path: String },
    Absolute { path: String },
    GitConflict { #[serde(rename = "repoRoot")] repo_root: String, path: String, baseline: crate::git::conflict_snapshot::Baseline },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Encoding {
    Utf8,
    Bytes,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    version: u32,
    request_id: String,
    target: Target,
    encoding: Encoding,
    byte_length: u64,
    timeout_ms: Option<u64>,
}

type Reply = oneshot::Sender<Result<(), String>>;
enum Operation {
    Append {
        offset: u64,
        bytes: Vec<u8>,
        reply: Reply,
    },
    Commit(Reply),
    Wake,
}

struct Control {
    owner: String,
    state: AtomicU8,
    reason: Mutex<String>,
    started: Instant,
    progress: Mutex<Instant>,
    limits: Limits,
    sender: mpsc::SyncSender<Operation>,
}
impl Control {
    fn remaining(&self) -> Result<Duration, String> {
        if self.state.load(Ordering::Acquire) == CANCELLED {
            return Err(self.reason.lock().unwrap().clone());
        }
        let total = self
            .limits
            .total
            .checked_sub(self.started.elapsed())
            .ok_or("文件写入超过总期限，原文件未修改。")?;
        let idle = self
            .limits
            .idle
            .checked_sub(self.progress.lock().unwrap().elapsed())
            .ok_or("文件写入等待下一步超时，原文件未修改。")?;
        Ok(total.min(idle))
    }
    fn progress(&self) -> Result<(), String> {
        self.remaining()?;
        *self.progress.lock().unwrap() = Instant::now();
        Ok(())
    }
    fn cancel(&self, reason: String) -> bool {
        let mut stored = self.reason.lock().unwrap();
        if self
            .state
            .compare_exchange(LIVE, CANCELLED, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            *stored = reason;
            let _ = self.sender.try_send(Operation::Wake);
            true
        } else {
            self.state.load(Ordering::Acquire) == CANCELLED
        }
    }
    fn publish_gate(&self) -> Result<(), String> {
        self.remaining()?;
        self.state
            .compare_exchange(LIVE, PUBLISHING, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| "文件写入已取消，原文件未修改。".into())
    }
}

pub(super) struct WriteSessions {
    controls: Mutex<HashMap<String, Arc<Control>>>,
    limits: Limits,
}
impl WriteSessions {
    pub(super) fn new(limits: Limits) -> Self {
        Self {
            controls: Mutex::new(HashMap::new()),
            limits,
        }
    }
    #[cfg(test)]
    pub(super) fn active_count(&self) -> usize {
        self.controls.lock().unwrap().len()
    }

    pub(super) async fn begin(self: &Arc<Self>, owner: &str, value: Value) -> Result<(), String> {
        if serde_json::to_vec(&value)
            .map_err(|error| error.to_string())?
            .len()
            > MAX_METADATA_BYTES
        {
            return Err("文件写入 metadata 超过大小上限。".into());
        }
        let metadata: Metadata = serde_json::from_value(value)
            .map_err(|error| format!("文件写入 metadata 无效: {error}"))?;
        if metadata.version != 1 || !valid_id(&metadata.request_id) {
            return Err("文件写入协议版本或会话标识无效。".into());
        }
        let (sender, receiver) = mpsc::sync_channel(1);
        let limits = Limits {
            total: metadata
                .timeout_ms
                .map_or(self.limits.total, |milliseconds| {
                    self.limits.total.min(Duration::from_millis(milliseconds))
                }),
            ..self.limits
        };
        let control = Arc::new(Control {
            owner: owner.into(),
            state: AtomicU8::new(LIVE),
            reason: Mutex::new(String::new()),
            started: Instant::now(),
            progress: Mutex::new(Instant::now()),
            limits,
            sender,
        });
        {
            let mut controls = self.controls.lock().unwrap();
            if controls.contains_key(&metadata.request_id) {
                return Err("文件写入会话标识已在使用。".into());
            }
            if controls.len() >= self.limits.maximum {
                return Err("文件写入会话已达并发上限，请稍后重试。".into());
            }
            controls.insert(metadata.request_id.clone(), control.clone());
        }
        let (reply, ready) = oneshot::channel();
        let registry = Arc::downgrade(self);
        let worker_control = control.clone();
        tauri::async_runtime::spawn_blocking(move || {
            worker(registry, metadata, worker_control, receiver, reply)
        });
        receive(control, ready).await
    }

    fn find(&self, owner: &str, id: &str) -> Result<Arc<Control>, String> {
        let control = self
            .controls
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or("文件写入会话不存在或已结束。")?;
        if control.owner != owner {
            return Err("不能操作其他窗口的文件写入会话。".into());
        }
        Ok(control)
    }

    pub(super) async fn append(
        &self,
        owner: &str,
        id: &str,
        offset: u64,
        bytes: Vec<u8>,
    ) -> Result<(), String> {
        let control = self.find(owner, id)?;
        if bytes.is_empty() || bytes.len() > CHUNK_BYTES {
            let error = "文件写入块必须为 1 至 256KiB。".to_string();
            control.cancel(error.clone());
            return Err(error);
        }
        let (reply, response) = oneshot::channel();
        enqueue(
            &control,
            Operation::Append {
                offset,
                bytes,
                reply,
            },
        )?;
        receive(control, response).await
    }

    pub(super) async fn commit(&self, owner: &str, id: &str) -> Result<(), String> {
        let control = self.find(owner, id)?;
        let (reply, response) = oneshot::channel();
        enqueue(&control, Operation::Commit(reply))?;
        receive(control, response).await
    }

    pub(super) fn abort(&self, owner: &str, id: &str) -> Result<(), String> {
        let controls = self.controls.lock().unwrap();
        let Some(control) = controls.get(id) else {
            return Ok(());
        };
        if control.owner != owner {
            return Err("不能取消其他窗口的文件写入会话。".into());
        }
        if control.cancel("文件写入已取消，原文件未修改。".into()) {
            Ok(())
        } else {
            Err("文件正在原子提交，请等待真实保存结果。".into())
        }
    }

    pub(super) fn close_owner(&self, owner: &str) {
        for control in self
            .controls
            .lock()
            .unwrap()
            .values()
            .filter(|control| control.owner == owner)
        {
            control.cancel("所属窗口已关闭，文件写入取消。".into());
        }
    }
}

fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}
fn enqueue(control: &Control, operation: Operation) -> Result<(), String> {
    control.remaining()?;
    control.sender.try_send(operation).map_err(|error| {
        let message = format!("文件写入会话忙碌或已结束: {error}");
        control.cancel(message.clone());
        message
    })
}
async fn receive(
    control: Arc<Control>,
    mut response: oneshot::Receiver<Result<(), String>>,
) -> Result<(), String> {
    loop {
        let remaining = match control.remaining() {
            Ok(remaining) => remaining,
            Err(error) => {
                if control.cancel(error.clone()) {
                    return Err(error);
                }
                // 已跨过原子发布点时，以真实 rename 回执为准；不能先报失败再晚到提交。
                return response
                    .await
                    .map_err(|_| "文件写入任务已结束。".to_string())?;
            }
        };
        match tokio::time::timeout(remaining, &mut response).await {
            Ok(result) => return result.map_err(|_| "文件写入任务已结束。".to_string())?,
            Err(_) => continue,
        }
    }
}

fn resolve(target: Target, id: &str) -> Result<(PathBuf, Option<crate::git::conflict_snapshot::WriteGuard>), String> {
    match target {
        Target::Vault { root, path } => {
            let root = Path::new(&root)
                .canonicalize()
                .map_err(|error| format!("无法解析工作区根: {error}"))?;
            resolve_new_target_in_root(&root, &path).map(|path| (path, None))
        }
        Target::Absolute { path } => {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                Ok((path, None))
            } else {
                Err("另存为/导出路径必须是绝对路径。".into())
            }
        }
        Target::GitConflict { repo_root, path, baseline } => crate::git::conflict_snapshot::WriteGuard::begin(repo_root, path, baseline, id.into()).map(|(path, guard)| (path, Some(guard))),
    }
}

fn finish(
    registry: &Weak<WriteSessions>,
    id: &str,
    control: &Control,
    staged: Option<&mut StagedWrite>,
    conflict: Option<&mut Option<crate::git::conflict_snapshot::WriteGuard>>,
    result: Result<(), String>,
) -> Result<(), String> {
    let result = match staged.map(StagedWrite::discard).transpose() {
        Ok(_) => result,
        Err(cleanup) => Err(match result {
            Ok(()) => cleanup,
            Err(error) => format!("{error}; {cleanup}"),
        }),
    };
    // Remove the owned staging file before releasing Git admission, and release
    // admission before sending the result so a subsequent operation can start.
    if let Some(guard) = conflict { drop(guard.take()); }
    control.state.store(DONE, Ordering::Release);
    if let Some(registry) = registry.upgrade() {
        registry.controls.lock().unwrap().remove(id);
    }
    result
}

fn worker(
    registry: Weak<WriteSessions>,
    metadata: Metadata,
    control: Arc<Control>,
    receiver: mpsc::Receiver<Operation>,
    ready: Reply,
) {
    let Metadata {
        request_id: id,
        target,
        encoding,
        byte_length,
        ..
    } = metadata;
    let opened = control
        .remaining()
        .and_then(|_| {
            if matches!(&target, Target::GitConflict { .. }) && (!matches!(encoding, Encoding::Utf8) || byte_length > crate::git::conflict_snapshot::MAX_BYTES) {
                return Err("冲突保存必须为不超过 100MiB 的 UTF-8 正文。".into());
            }
            resolve(target, &id)
        })
        .and_then(|(target, guard)| StagedWrite::new(&target).map(|staged| (staged, guard)));
    let (mut staged, mut conflict) = match opened {
        Ok(value) => value,
        Err(error) => {
            let result = finish(&registry, &id, &control, None, None, Err(error));
            let _ = ready.send(result);
            return;
        }
    };
    if let Err(error) = control.progress() {
        let result = finish(&registry, &id, &control, Some(&mut staged), Some(&mut conflict), Err(error));
        let _ = ready.send(result);
        return;
    }
    if ready.send(Ok(())).is_err() {
        control.cancel("文件写入请求已关闭。".into());
    }
    let mut received = 0u64;
    let mut utf8 = Utf8Validator::default();
    loop {
        let remaining = match control.remaining() {
            Ok(remaining) => remaining,
            Err(error) => {
                let _ = finish(&registry, &id, &control, Some(&mut staged), Some(&mut conflict), Err(error));
                return;
            }
        };
        let operation = match receiver.recv_timeout(remaining) {
            Ok(operation) => operation,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(_) => {
                let _ = finish(
                    &registry,
                    &id,
                    &control,
                    Some(&mut staged),
                    Some(&mut conflict),
                    Err("文件写入通道已关闭。".into()),
                );
                return;
            }
        };
        match operation {
            Operation::Wake => continue,
            Operation::Append {
                offset,
                bytes,
                reply,
            } => {
                let result = (|| {
                    control.remaining()?;
                    if offset != received {
                        return Err("文件写入块的偏移不连续，整次保存已取消。".into());
                    }
                    let end = received
                        .checked_add(bytes.len() as u64)
                        .ok_or("文件写入长度溢出。")?;
                    if end > byte_length {
                        return Err("文件写入超过声明长度，整次保存已取消。".into());
                    }
                    if matches!(encoding, Encoding::Utf8) {
                        utf8.append(&bytes)?;
                    }
                    staged.append(&bytes)?;
                    control.progress()?;
                    received = end;
                    Ok(())
                })();
                if result.is_err() {
                    let result = finish(&registry, &id, &control, Some(&mut staged), Some(&mut conflict), result);
                    let _ = reply.send(result);
                    return;
                }
                if reply.send(result).is_err() {
                    control.cancel("文件写入请求已关闭。".into());
                }
            }
            Operation::Commit(reply) => {
                let result = (|| {
                    control.remaining()?;
                    if received != byte_length {
                        return Err("文件写入长度与声明不符，原文件未修改。".into());
                    }
                    if matches!(encoding, Encoding::Utf8) {
                        utf8.finish()?;
                    }
                    staged.prepare()?;
                    if let Some(conflict) = &conflict { conflict.verify(staged.prepared_path()?)?; }
                    control.publish_gate()?;
                    staged.publish()?;
                    if let Some(conflict) = &conflict { conflict.stage(control.started + control.limits.total)?; }
                    Ok(())
                })();
                let result = finish(&registry, &id, &control, Some(&mut staged), Some(&mut conflict), result);
                let _ = reply.send(result);
                return;
            }
        }
    }
}

#[tauri::command]
pub async fn begin_file_write(window: tauri::WebviewWindow, metadata: Value) -> Result<(), String> {
    SESSIONS.begin(window.label(), metadata).await
}

#[tauri::command]
pub async fn append_file_write(
    window: tauri::WebviewWindow,
    request: Request<'_>,
) -> Result<(), String> {
    let id = request
        .headers()
        .get(ID_HEADER)
        .and_then(|header| header.to_str().ok())
        .filter(|id| valid_id(id))
        .ok_or("文件写入缺少有效会话标识。")?
        .to_string();
    let parsed = (|| {
        let offset = request
            .headers()
            .get(OFFSET_HEADER)
            .and_then(|header| header.to_str().ok())
            .ok_or("文件写入缺少块偏移。")?
            .parse::<u64>()
            .map_err(|_| "文件写入偏移无效。")?;
        let InvokeBody::Raw(bytes) = request.body() else {
            return Err("文件写入块必须使用 Raw 请求体。".to_string());
        };
        if bytes.is_empty() || bytes.len() > CHUNK_BYTES {
            return Err("文件写入块必须为 1 至 256KiB。".into());
        }
        Ok((offset, bytes.clone()))
    })();
    match parsed {
        Ok((offset, bytes)) => SESSIONS.append(window.label(), &id, offset, bytes).await,
        Err(error) => {
            let _ = SESSIONS.abort(window.label(), &id);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn commit_file_write(
    window: tauri::WebviewWindow,
    request_id: String,
) -> Result<(), String> {
    SESSIONS.commit(window.label(), &request_id).await
}
#[tauri::command]
pub fn abort_file_write(window: tauri::WebviewWindow, request_id: String) -> Result<(), String> {
    SESSIONS.abort(window.label(), &request_id)
}
pub(crate) fn close_owner(owner: &str) {
    SESSIONS.close_owner(owner);
}
