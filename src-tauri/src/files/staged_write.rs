use std::fs::{File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

/// 所有保存共用的同目录暂存文件。只有 publish 会替换目标；其余路径销毁本次拥有的 temp。
pub(super) struct StagedWrite {
    target: PathBuf,
    temp: Option<PathBuf>,
    file: Option<File>,
    #[cfg(unix)]
    permissions: Option<std::fs::Permissions>,
}

impl StagedWrite {
    pub(super) fn prepared_path(&self) -> Result<&Path, String> {
        if self.file.is_some() { return Err("临时文件尚未同步关闭。".into()); }
        self.temp.as_deref().ok_or_else(|| "临时文件已完成提交。".into())
    }
    pub(super) fn new(target: &Path) -> Result<Self, String> {
        #[cfg(windows)]
        let resolved = super::publish_path::target(target)?;
        #[cfg(windows)]
        let target = resolved.as_path();
        #[cfg(unix)]
        let permissions = match std::fs::metadata(target) {
            Ok(metadata) => Some(metadata.permissions()),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => return Err(format!("无法读取目标文件权限: {error}")),
        };
        for _ in 0..16 {
            let temp = super::temp_sibling(target);
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            if let Some(permissions) = &permissions {
                use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
                options.mode(permissions.mode() & 0o7777);
            }
            match options.open(&temp) {
                Ok(file) => {
                    return Ok(Self {
                        target: target.to_path_buf(),
                        temp: Some(temp),
                        file: Some(file),
                        #[cfg(unix)]
                        permissions,
                    })
                }
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("无法创建临时文件: {error}")),
            }
        }
        Err("无法创建唯一的临时文件。".into())
    }

    pub(super) fn append(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.file
            .as_mut()
            .ok_or("临时文件已关闭。")?
            .write_all(bytes)
            .map_err(|error| format!("无法写入临时文件: {error}"))
    }

    /// 文件关闭后才允许 Windows rename；现有 Unix mode 在写完后精确恢复，随后 fsync。
    pub(super) fn prepare(&mut self) -> Result<(), String> {
        let file = self.file.as_mut().ok_or("临时文件已关闭。")?;
        #[cfg(unix)]
        if let Some(permissions) = &self.permissions {
            file.set_permissions(permissions.clone())
                .map_err(|error| format!("无法恢复文件权限: {error}"))?;
        }
        file.sync_all()
            .map_err(|error| format!("无法同步临时文件: {error}"))?;
        self.file.take();
        Ok(())
    }

    pub(super) fn publish(&mut self) -> Result<(), String> {
        if self.file.is_some() {
            return Err("临时文件尚未同步关闭。".into());
        }
        let temp = self.temp.as_ref().ok_or("文件已完成提交。")?;
        std::fs::rename(temp, &self.target)
            .map_err(|error| format!("无法落盘（rename 失败）: {error}"))?;
        self.temp.take();
        #[cfg(unix)]
        if let Some(parent) = self.target.parent() {
            if let Ok(directory) = File::open(parent) {
                let _ = directory.sync_all();
            }
        }
        Ok(())
    }

    pub(super) fn discard(&mut self) -> Result<(), String> {
        self.file.take();
        if let Some(temp) = &self.temp {
            match std::fs::remove_file(temp) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "临时文件清理失败，保留于 {}: {error}",
                        temp.display()
                    ))
                }
            }
            self.temp.take();
        }
        Ok(())
    }
}

impl Drop for StagedWrite {
    fn drop(&mut self) {
        let _ = self.discard();
    }
}
