use super::read_target;
use super::stream_control::{self, Lease, Limits, CHUNK_BYTES};
use std::io::Read;
use tauri::ipc::{Channel, InvokeResponseBody};

pub use super::read_target::FileReadTarget;

/// 单个打开句柄、单次顺序读取；控制帧是小JSON，正文只用Raw offset+bytes帧。
#[tauri::command]
pub async fn read_file_stream(
    request_id: String,
    target: FileReadTarget,
    channel: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    read_with_limits(request_id, target, channel, Limits::default()).await
}

pub(super) async fn read_with_limits(
    request_id: String,
    target: FileReadTarget,
    channel: Channel<InvokeResponseBody>,
    limits: Limits,
) -> Result<(), String> {
    let lease = stream_control::register(request_id, limits)?;
    let control = lease.control.clone();
    let mut worker =
        tauri::async_runtime::spawn_blocking(move || read_worker(target, channel, lease));
    loop {
        let remaining = match control.remaining() {
            Ok(remaining) => remaining,
            Err(error) => {
                control.cancel();
                return Err(error);
            }
        };
        match tokio::time::timeout(remaining, &mut worker).await {
            Ok(result) => return result.map_err(|e| format!("文件读取任务失败: {e}"))?,
            // 有新进度则重算空闲期限；总期限不延长。阻塞在OS内的read保留原生槽位直到返回。
            Err(_) => continue,
        }
    }
}

fn send_control(
    channel: &Channel<InvokeResponseBody>,
    value: serde_json::Value,
) -> Result<(), String> {
    channel
        .send(InvokeResponseBody::Json(value.to_string()))
        .map_err(|e| format!("文件读取通道已关闭: {e}"))
}

fn read_worker(
    target: FileReadTarget,
    channel: Channel<InvokeResponseBody>,
    lease: Lease,
) -> Result<(), String> {
    lease.control.remaining()?;
    let mut opened = read_target::open(target)?;
    lease.control.remaining()?;
    let modified = opened
        .file
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok());
    send_control(
        &channel,
        serde_json::json!({ "type": "start", "byteLength": opened.byte_length, "chunkBytes": CHUNK_BYTES }),
    )?;
    lease.control.progress()?;
    let mut buffer = vec![0u8; CHUNK_BYTES.min(opened.byte_length.max(1) as usize)];
    let mut utf8 = Utf8Validator::default();
    let mut offset = 0u64;
    loop {
        lease.control.remaining()?;
        let count = opened
            .file
            .read(&mut buffer)
            .map_err(|e| format!("无法读取文件: {e}"))?;
        if count == 0 {
            break;
        }
        if offset + count as u64 > opened.byte_length || offset + count as u64 > opened.maximum {
            return Err("文件在读取期间增长，整次读取已取消。".into());
        }
        if opened.text {
            utf8.append(&buffer[..count])?;
        }
        lease.control.reserve(count)?;
        let mut frame = Vec::with_capacity(count + 8);
        frame.extend_from_slice(&offset.to_le_bytes());
        frame.extend_from_slice(&buffer[..count]);
        channel
            .send(InvokeResponseBody::Raw(frame))
            .map_err(|e| format!("文件读取通道已关闭: {e}"))?;
        offset += count as u64;
    }
    if opened.text {
        utf8.finish()?;
    }
    let final_metadata = opened
        .file
        .metadata()
        .map_err(|e| format!("无法确认文件读取结果: {e}"))?;
    if offset != opened.byte_length
        || final_metadata.len() != opened.byte_length
        || final_metadata.modified().ok() != modified
    {
        return Err("文件在读取期间发生变化，整次读取已取消。".into());
    }
    lease.control.remaining()?;
    send_control(
        &channel,
        serde_json::json!({ "type": "end", "byteLength": offset }),
    )
}

/// 只保留最多三个未完成UTF8字节，不为验证再读文件或复制整篇正文。
#[derive(Default)]
struct Utf8Validator {
    tail: Vec<u8>,
}
impl Utf8Validator {
    fn append(&mut self, bytes: &[u8]) -> Result<(), String> {
        let mut offset = 0;
        while !self.tail.is_empty() && offset < bytes.len() {
            self.tail.push(bytes[offset]);
            offset += 1;
            match std::str::from_utf8(&self.tail) {
                Ok(_) => self.tail.clear(),
                Err(error) if error.error_len().is_none() => {}
                Err(_) => return Err("文件不是有效的UTF-8文本。".into()),
            }
        }
        if !self.tail.is_empty() {
            return Ok(());
        }
        let remaining = &bytes[offset..];
        match std::str::from_utf8(remaining) {
            Ok(_) => Ok(()),
            Err(error) if error.error_len().is_none() => {
                self.tail
                    .extend_from_slice(&remaining[error.valid_up_to()..]);
                Ok(())
            }
            Err(_) => Err("文件不是有效的UTF-8文本。".into()),
        }
    }
    fn finish(&self) -> Result<(), String> {
        if self.tail.is_empty() {
            Ok(())
        } else {
            Err("文件末尾包含不完整的UTF-8字符。".into())
        }
    }
}

#[tauri::command]
pub fn ack_file_read(request_id: String, received_bytes: u64) -> Result<(), String> {
    stream_control::acknowledge(&request_id, received_bytes)
}

#[tauri::command]
pub fn cancel_file_read(request_id: String) -> Result<(), String> {
    stream_control::cancel(request_id)
}
