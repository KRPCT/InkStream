use std::path::{Component, Path, PathBuf};

/// 目标只在完整克隆后出现。此前所有内容都在本次独占的同目录 staging 中。
pub(super) struct Destination {
    pub stage: PathBuf,
    pub target: PathBuf,
    owned: bool,
    cleanup_allowed: bool,
}

fn available(target: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(target) {
        Ok(_) => Err("目标目录已存在，原有文件保持不变。请选择新的目录名称。".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法确认目标目录: {error}")),
    }
}

pub(super) fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(path) = text.strip_prefix(r"\\?\UNC\") {
            return format!("//{}", path.replace('\\', "/"));
        }
        if let Some(path) = text.strip_prefix(r"\\?\") {
            return path.replace('\\', "/");
        }
        text.replace('\\', "/")
    }
    #[cfg(not(windows))]
    {
        text.into_owned()
    }
}

impl Destination {
    pub(super) fn create(destination: &str, request_id: &str) -> Result<Self, String> {
        let requested = Path::new(destination);
        if !requested.is_absolute()
            || requested
                .components()
                .any(|part| matches!(part, Component::ParentDir))
        {
            return Err("克隆目标必须是绝对路径，且不能包含上级目录跳转。".into());
        }
        let leaf = requested
            .file_name()
            .and_then(|leaf| leaf.to_str())
            .ok_or("请选择目标父目录和新的目录名称。")?;
        if leaf.is_empty()
            || leaf.ends_with(['.', ' '])
            || leaf.chars().any(|c| {
                c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            })
        {
            return Err("克隆目录名称无效。".into());
        }
        #[cfg(windows)]
        {
            let device = leaf.split('.').next().unwrap_or(leaf).to_ascii_uppercase();
            if ["CON", "PRN", "AUX", "NUL"].contains(&device.as_str())
                || (device.len() == 4
                    && (device.starts_with("COM") || device.starts_with("LPT"))
                    && matches!(device.as_bytes()[3], b'1'..=b'9'))
            {
                return Err("克隆目录名称是系统保留名称。".into());
            }
        }
        let parent = requested
            .parent()
            .ok_or("请选择目标父目录。")?
            .canonicalize()
            .map_err(|error| format!("无法打开目标父目录: {error}"))?;
        if !parent.is_dir() {
            return Err("目标父路径不是目录。".into());
        }
        let target = parent.join(leaf);
        available(&target)?;
        let stage = parent.join(format!(".inkstream-clone-{request_id}"));
        let same = stage == target;
        #[cfg(windows)]
        let same = same || display_path(&stage).eq_ignore_ascii_case(&display_path(&target));
        if same {
            return Err("请选择不以本次内部克隆目录命名的目标。".into());
        }
        std::fs::create_dir(&stage).map_err(|error| format!("无法创建独占克隆目录: {error}"))?;
        Ok(Self {
            stage,
            target,
            owned: true,
            cleanup_allowed: true,
        })
    }

    /// 外部进程启动后，只有 runner 证明整个进程树退出，才能重新允许删除其工作目录。
    pub(super) fn before_process(&mut self) {
        self.cleanup_allowed = false;
    }
    pub(super) fn processes_stopped(&mut self) {
        self.cleanup_allowed = true;
    }

    pub(super) fn validate_repository(&self) -> Result<(), String> {
        let repo = git2::Repository::open_ext(
            &self.stage,
            git2::RepositoryOpenFlags::NO_SEARCH,
            std::iter::empty::<&Path>(),
        )
        .map_err(|_| "Git 未返回完整可打开的仓库，克隆未发布。")?;
        let workdir = repo
            .workdir()
            .ok_or("克隆结果没有工作树。")?
            .canonicalize()
            .map_err(|error| format!("无法确认克隆工作树: {error}"))?;
        if repo.is_bare()
            || workdir
                != self
                    .stage
                    .canonicalize()
                    .map_err(|error| error.to_string())?
        {
            return Err("克隆工作树与本次目标不符。".into());
        }
        Ok(())
    }

    pub(super) fn publish(&mut self) -> Result<String, String> {
        rename_new(&self.stage, &self.target).map_err(|error| {
            format!("无法发布克隆目录，目标可能已经存在；现有文件未覆盖: {error}")
        })?;
        self.owned = false;
        Ok(display_path(&self.target))
    }

    pub(super) fn cleanup(&mut self) -> Result<(), String> {
        if !self.owned {
            return Ok(());
        }
        if !self.cleanup_allowed {
            return Err("无法确认克隆进程已全部退出，已保留临时目录。".into());
        }
        // 不跟随后来替换的目录链接；真实 Git 仓库内部的 symlink 由 remove_dir_all 本身按链接移除。
        let metadata = match std::fs::symlink_metadata(&self.stage) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.owned = false;
                return Ok(());
            }
            Err(error) => return Err(format!("无法确认本次临时目录: {error}")),
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("本次临时目录已被替换，未删除该路径。".into());
        }
        #[cfg(windows)]
        writable_owned_files(&self.stage)
            .map_err(|error| format!("无法清理克隆中的只读文件: {error}"))?;
        std::fs::remove_dir_all(&self.stage)
            .map_err(|error| format!("无法清理本次克隆目录: {error}"))?;
        self.owned = false;
        Ok(())
    }
}

impl Drop for Destination {
    fn drop(&mut self) {
        if self.cleanup_allowed {
            let _ = self.cleanup();
        }
    }
}

#[cfg(windows)]
pub(super) fn writable_owned_files(path: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(path)? {
        let path = entry?.path();
        let metadata = std::fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            writable_owned_files(&path)?;
        } else if metadata.is_file() && metadata.permissions().readonly() {
            let mut permissions = metadata.permissions();
            permissions.set_readonly(false);
            std::fs::set_permissions(path, permissions)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn rename_new(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(source.as_ptr(), target.as_ptr(), 0)
    } == 0
    {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn rename_new(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::unix::ffi::OsStrExt;
    let source =
        std::ffi::CString::new(source.as_os_str().as_bytes()).map_err(std::io::Error::other)?;
    let target =
        std::ffi::CString::new(target.as_os_str().as_bytes()).map_err(std::io::Error::other)?;
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            target.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(target_os = "macos")]
    let result = unsafe { libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
fn rename_new(_source: &Path, _target: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "此平台不支持排他的目录发布。",
    ))
}
