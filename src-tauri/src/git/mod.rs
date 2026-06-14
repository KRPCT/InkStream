//! Phase 6 GIT-01：原生 git（libgit2 绑定）命令地基 + 读命令（status/branch/log/diff）。
//!
//! 架构（见记忆 inkstream-phase6-git）：
//! - git2 是**同步阻塞** C 库（libgit2），故所有命令把同步 git 工作丢进 `spawn_blocking`
//!   （专用阻塞线程池），绝不阻塞 tauri 的 tokio 工作线程。与 index.rs 的 mpsc 单写 worker 不同——
//!   git 读命令无状态、可并发，范式是「每命令现开仓库 + 阻塞线程跑」。
//! - `git2::Repository` 非 Send/Sync（内持裸 libgit2 句柄），**绝不缓存进 State**；每命令在
//!   `spawn_blocking` 闭包内 `open_repo` 现开现用现 drop（open 仅读 .git 元数据，毫秒级）。
//! - 可测性：每命令的纯 git2 逻辑抽成不依赖 tauri 的同步函数（collect_status/list_branches/
//!   walk_log/build_diff），command 仅 blocking 包装。纯函数用临时 repo 单测（git/tests.rs）。
//!
//! 写命令（commit/checkout/...）见 W3；远程（clone/push/pull/fetch）+ 凭据 + 进度 Channel 见 W4。
//! SSH 签名提交走 git CLI sidecar（用户裁定，复用 gitconfig SSH 签名链路保 Verified），W3 落地。

// 子模块 pub(crate)：lib.rs 的 generate_handler! 须按全路径（git::status::git_status）引用命令，
// 才能连带解析 #[tauri::command] 在该模块生成的 __cmd__/__tauri_command_name_ 辅助项
// （pub use 只重导出函数本体、不含这些隐藏宏项，故不可用 git::git_status 简写）。
pub(crate) mod branch;
pub(crate) mod diff;
pub(crate) mod log;
pub(crate) mod status;
mod types;

#[cfg(test)]
mod tests;

/// 统一 git 错误 → 前端友好串。git2::Error 的 message 含 libgit2 英文原文，
/// 关键类别（非仓库 / 无提交）单独中文友好化，其余透传原文加前缀。
#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("这个文件夹不是 git 仓库")]
    NotARepo,
    #[error("仓库还没有任何提交")]
    Unborn,
    #[error("git 操作失败：{0}")]
    Git(String),
    #[error("内部错误：{0}")]
    Internal(String),
}

impl From<git2::Error> for GitError {
    fn from(e: git2::Error) -> Self {
        use git2::{ErrorClass, ErrorCode};
        match e.code() {
            ErrorCode::NotFound if e.class() == ErrorClass::Repository => GitError::NotARepo,
            ErrorCode::UnbornBranch => GitError::Unborn,
            _ => GitError::Git(e.message().to_string()),
        }
    }
}

impl From<GitError> for String {
    fn from(e: GitError) -> String {
        e.to_string()
    }
}

/// 打开仓库句柄：每命令现开现用（Repository 非 Send，不缓存——见模块注释）。
pub fn open_repo(repo_root: &str) -> Result<git2::Repository, GitError> {
    git2::Repository::open(repo_root).map_err(GitError::from)
}

/// 把同步阻塞的 git2 闭包丢到阻塞线程池跑，避免阻塞 tokio 工作线程。
/// 闭包内开/用/drop Repository——绝不跨 await（满足 !Send）。
pub async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, GitError> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(f).await {
        Ok(r) => r.map_err(String::from),
        Err(e) => Err(GitError::Internal(format!("git 任务调度失败: {e}")).into()),
    }
}
