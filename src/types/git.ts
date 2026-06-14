/**
 * git 相关类型（前端真相源镜像，与 Rust git/types.rs 的 serde camelCase 形状对齐）。Phase 6 GIT-01。
 */

/** 工作区单文件状态标签（与 Rust classify 一致）。 */
export type GitFileKind =
  | 'new'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'typechange'
  | 'conflicted'
  | 'untracked';

/** 工作区单文件状态（暂存/未暂存 + 单语义标签）。 */
export interface GitFileStatus {
  path: string;
  staged: boolean;
  unstaged: boolean;
  status: GitFileKind;
}

/** 工作区状态总览（当前分支 + 变更文件清单）。 */
export interface GitStatus {
  /** 当前分支短名；detached/unborn 时 null。 */
  branch: string | null;
  files: GitFileStatus[];
}

/** 分支信息（本地 + 远程，含 ahead/behind 与 tip oid）。 */
export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isHead: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  /** 分支 tip 的 oid（hex）；git-graph 连边用。 */
  target: string | null;
}

/** 单个提交元数据（git-graph / log 列表 / 提交详情共用）。 */
export interface CommitInfo {
  oid: string;
  parents: string[];
  summary: string;
  body: string;
  authorName: string;
  authorEmail: string;
  /** commit time（unix 秒，UTC；前端按本地时区格式化）。 */
  authorTime: number;
  /** 指向此 commit 的分支/tag 短名（W2 填，本期空）。 */
  refs: string[];
}

/** diff 单行（origin: ' ' 上下文 / '+' 增 / '-' 删）。 */
export interface DiffLine {
  origin: string;
  oldLineno: number | null;
  newLineno: number | null;
  content: string;
}

/** diff 单块（@@ 头 + 行）。 */
export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

/** 单文件 diff（结构化 hunk，不传整文件 patch 文本）。 */
export interface FileDiff {
  oldPath: string | null;
  newPath: string | null;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange';
  binary: boolean;
  hunks: DiffHunk[];
}

/**
 * diff 目标（↔ Rust DiffTarget enum，externally-tagged）：
 * 'workdir' = 工作区(含暂存)↔HEAD；'staged' = 暂存区↔HEAD；
 * { commit } = 单 commit(vs 首父，root vs 空树)；{ commits } = 两 commit 间。
 */
export type DiffTarget =
  | 'workdir'
  | 'staged'
  | { commit: { oid: string } }
  | { commits: { from: string; to: string } };

/** 指向某 commit 的 ref（git-graph 行内徽章；W2）。 */
export interface GitRef {
  /** 短名：'main' / 'origin/main' / 'v1.0.0'。 */
  name: string;
  kind: 'localBranch' | 'remoteBranch' | 'tag';
  /** 此 ref 指向的 commit oid（annotated tag 已 peel 到 commit）。 */
  targetOid: string;
}
