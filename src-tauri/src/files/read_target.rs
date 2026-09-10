use super::{READ_BYTES_MAX, READ_FILE_INLINE_LIMIT_BYTES, READ_IMAGE_MAX};
use crate::path_guard::canonicalize_in_root;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileReadTarget {
    Text { root: String, path: String },
    Reading { path: String },
    Image { path: String },
}

pub(super) struct OpenedFile {
    pub file: File,
    pub byte_length: u64,
    pub maximum: u64,
    pub text: bool,
}

fn absolute(path: String) -> Result<PathBuf, String> {
    let target = PathBuf::from(path);
    if !target.is_absolute() {
        return Err("读取路径必须是绝对路径".into());
    }
    Ok(target)
}

/// 保留三种已有读取范围；不把受限的阅读/图片读取扩大成任意绝对路径读取。
pub(super) fn open(target: FileReadTarget) -> Result<OpenedFile, String> {
    let (path, maximum, text) = match target {
        FileReadTarget::Text { root, path } => {
            let root = Path::new(&root)
                .canonicalize()
                .map_err(|e| format!("无法解析工作区根: {e}"))?;
            (canonicalize_in_root(&root, &path)?, READ_BYTES_MAX, true)
        }
        FileReadTarget::Reading { path } => {
            let path = absolute(path)?;
            let extension = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(str::to_ascii_lowercase);
            if !matches!(
                extension.as_deref(),
                Some("txt" | "md" | "markdown" | "docx" | "epub" | "pdf")
            ) {
                return Err("仅支持读取 txt / md / markdown / docx / epub / pdf".into());
            }
            (path, READ_BYTES_MAX, false)
        }
        FileReadTarget::Image { path } => {
            let path = absolute(path)?;
            let extension = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(str::to_ascii_lowercase);
            if !matches!(
                extension.as_deref(),
                Some("png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" | "svg" | "avif" | "ico")
            ) {
                return Err("仅支持读取图片文件".into());
            }
            (path, READ_IMAGE_MAX, false)
        }
    };
    let file = File::open(path).map_err(|e| format!("无法读取文件: {e}"))?;
    let metadata = file
        .metadata()
        .map_err(|e| format!("无法读取文件信息: {e}"))?;
    if !metadata.is_file() {
        return Err("只能读取普通文件".into());
    }
    if metadata.len() > maximum {
        return Err(format!("文件超过{}MiB读取上限。", maximum / 1024 / 1024));
    }
    Ok(OpenedFile {
        file,
        byte_length: metadata.len(),
        maximum,
        text,
    })
}

/// 旧JSON入口只保留小回复兼容性；读取也有上限，文件增长不会绕过检查。
pub(super) fn legacy_bytes(target: FileReadTarget) -> Result<Vec<u8>, String> {
    let opened = open(target)?;
    if opened.byte_length > READ_FILE_INLINE_LIMIT_BYTES {
        return Err(inline_error());
    }
    let mut bytes = Vec::with_capacity(opened.byte_length as usize);
    opened
        .file
        .take(READ_FILE_INLINE_LIMIT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("无法读取文件: {e}"))?;
    if bytes.len() as u64 > READ_FILE_INLINE_LIMIT_BYTES {
        return Err(inline_error());
    }
    if bytes.len() as u64 != opened.byte_length {
        return Err("文件在读取期间改变了长度，请重试。".into());
    }
    Ok(bytes)
}

fn inline_error() -> String {
    "回复超过1MiB，请使用流式文件读取。".into()
}

/// 检查实际JSON长度而不创建JSON副本：number[]可能膨胀约四倍，不能只检查原文件大小。
pub(super) fn check_inline<T: Serialize + ?Sized>(value: &T) -> Result<(), String> {
    struct LimitWriter(u64);
    impl Write for LimitWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self.0.saturating_add(bytes.len() as u64);
            if self.0 > READ_FILE_INLINE_LIMIT_BYTES {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "inline response limit",
                ));
            }
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(LimitWriter(0), value).map_err(|_| inline_error())
}
