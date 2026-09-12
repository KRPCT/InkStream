use crate::path_guard::resolve_new_target_in_root;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use tauri::ipc::{InvokeBody, Request};
use tokio::sync::Semaphore;

const MAX_METADATA_BYTES: usize = 256 * 1024;
static WRITE_SLOTS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(4)));

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum WriteTarget {
    Vault { root: String, path: String },
    Absolute { path: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum WriteEncoding {
    Utf8,
    Bytes,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteMetadata {
    version: u32,
    target: WriteTarget,
    encoding: WriteEncoding,
    byte_length: u64,
}

fn raw_body_error() -> String {
    "文件写入必须使用 Raw 请求体。".into()
}

#[tauri::command]
pub async fn write_file_raw(request: Request<'_>) -> Result<(), String> {
    match request.body() {
        InvokeBody::Raw(frame) => write_body(InvokeBody::Raw(frame.clone())).await,
        InvokeBody::Json(_) => Err(raw_body_error()),
    }
}

pub(super) async fn write_body(body: InvokeBody) -> Result<(), String> {
    let InvokeBody::Raw(frame) = body else {
        return Err(raw_body_error());
    };
    execute_file_write(move || persist_frame(&frame)).await
}

/// 原子落盘的阻塞部分仅在工作线程执行，同时最多四项；不会超时返回后让写入继续偷偷提交。
pub(super) async fn execute_file_write<F>(operation: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    let permit = WRITE_SLOTS
        .clone()
        .acquire_owned()
        .await
        .map_err(|error| format!("文件写入调度不可用: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        operation()
    })
    .await
    .map_err(|error| format!("文件写入任务失败: {error}"))?
}

fn persist_frame(frame: &[u8]) -> Result<(), String> {
    let header: [u8; 4] = frame
        .get(..4)
        .ok_or("Raw 写入帧缺少 metadata 长度。")?
        .try_into()
        .unwrap();
    let metadata_length = u32::from_le_bytes(header) as usize;
    if metadata_length == 0 || metadata_length > MAX_METADATA_BYTES {
        return Err("Raw metadata 长度无效或超过256KiB上限。".into());
    }
    let payload_start = 4usize
        .checked_add(metadata_length)
        .ok_or("Raw metadata 长度无效。")?;
    let metadata: WriteMetadata = serde_json::from_slice(
        frame
            .get(4..payload_start)
            .ok_or("Raw metadata 未完整接收。")?,
    )
    .map_err(|error| format!("Raw metadata 无效: {error}"))?;
    let bytes = frame.get(payload_start..).ok_or("Raw 正文未完整接收。")?;
    if metadata.version != 1 {
        return Err("不支持的 Raw 文件写入协议版本。".into());
    }
    if metadata.byte_length != bytes.len() as u64 {
        return Err("Raw 写入正文长度与声明不符，原文件未修改。".into());
    }
    if matches!(metadata.encoding, WriteEncoding::Utf8) {
        std::str::from_utf8(bytes).map_err(|error| format!("写入正文不是有效 UTF-8: {error}"))?;
    }
    let target = match metadata.target {
        WriteTarget::Vault { root, path } => {
            let root = Path::new(&root)
                .canonicalize()
                .map_err(|error| format!("无法解析工作区根: {error}"))?;
            resolve_new_target_in_root(&root, &path)?
        }
        WriteTarget::Absolute { path } => {
            let target = PathBuf::from(path);
            if !target.is_absolute() {
                return Err("另存为/导出路径必须是绝对路径。".into());
            }
            target
        }
    };
    super::write_atomic_bytes(&target, bytes)
}
