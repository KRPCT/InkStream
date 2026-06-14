//! git 读命令的前端共享 DTO（serde camelCase，与 src/types/git.ts 镜像）。

use serde::{Deserialize, Serialize};

/// 工作区单文件状态（暂存/未暂存 + 单语义标签）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub staged: bool,
    pub unstaged: bool,
    /// new/modified/deleted/renamed/typechange/conflicted/untracked（前端图标用）。
    pub status: String,
}

/// 工作区状态总览（当前分支 + 变更文件清单）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    /// 当前分支短名；detached/unborn 时 None。
    pub branch: Option<String>,
    pub files: Vec<GitFileStatus>,
}

/// 分支信息（本地 + 远程，含 ahead/behind 与 tip oid）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_head: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    /// 分支 tip 的 oid（hex）；git-graph 连边用。
    pub target: Option<String>,
}

/// 单个提交元数据（git-graph / log 列表 / 提交详情共用）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub oid: String,
    pub parents: Vec<String>,
    pub summary: String,
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    /// commit time（unix 秒，UTC；前端按本地时区格式化）。
    pub author_time: i64,
    /// 指向此 commit 的分支/tag 短名（W2 填，本期空）。
    pub refs: Vec<String>,
}

/// diff 单行（origin: ' ' 上下文 / '+' 增 / '-' 删）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub origin: char,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
    pub content: String,
}

/// diff 单块（@@ -a,b +c,d @@ 头 + 行）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

/// 单文件 diff（结构化 hunk，不传整文件 patch 文本）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    /// added/modified/deleted/renamed/copied/typechange。
    pub status: String,
    pub binary: bool,
    pub hunks: Vec<DiffHunk>,
}

/// diff 目标：工作区(含暂存)↔HEAD / 暂存区↔HEAD / 两 commit 间。
///
/// serde externally-tagged + lowercase 变体名：`Workdir`→`"workdir"`、`Staged`→`"staged"`、
/// `Commits{from,to}`→`{"commits":{"from":..,"to":..}}`（与前端 TS 联合精确对齐）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffTarget {
    Workdir,
    Staged,
    Commits { from: String, to: String },
}
