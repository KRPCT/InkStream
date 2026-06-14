import { invoke, invokeStreamed } from './invoke';
import type {
  BranchInfo,
  CommitInfo,
  DiffTarget,
  FileDiff,
  GitOpResult,
  GitProgress,
  GitRef,
  GitStatus,
  PullOutcome,
  ResetMode,
  StashEntry,
} from '../types/git';

/**
 * git 读命令 IPC 封装（Phase 6 GIT-01）。全部经类型化 invoke（src/types/ipc.ts 约束）。
 * 命令在 Rust 端 spawn_blocking 跑，前端拿到结构化 DTO。仓库根 = VaultInfo.repoRoot。
 */

/** 工作区状态（暂存/未暂存/未跟踪 + 当前分支）。 */
export function gitStatus(repoRoot: string): Promise<GitStatus> {
  return invoke('git_status', { repoRoot });
}

/** 本地 + 远程分支（含 ahead/behind、当前 HEAD）。 */
export function gitBranchList(repoRoot: string): Promise<BranchInfo[]> {
  return invoke('git_branch_list', { repoRoot });
}

/** 提交历史（拓扑 + 时间序，分页）。 */
export function gitLog(repoRoot: string, skip = 0, limit = 100): Promise<CommitInfo[]> {
  return invoke('git_log', { repoRoot, skip, limit });
}

/** 结构化 diff（工作区/暂存区/单 commit/两 commit 间）。 */
export function gitDiff(repoRoot: string, target: DiffTarget): Promise<FileDiff[]> {
  return invoke('git_diff', { repoRoot, target });
}

/** ref 清单（分支 + tag，按指向 commit oid）——git-graph 行内徽章数据源。 */
export function gitRefs(repoRoot: string): Promise<GitRef[]> {
  return invoke('git_refs', { repoRoot });
}

// ── 写命令（W3）。产生提交类走 git CLI -S 签名（保 Verified）；引用操作走 git2 ──────────

/** 暂存 + 签名提交（paths 空 = 全部改动）。 */
export function gitCommit(repoRoot: string, message: string, paths: string[] = []): Promise<GitOpResult> {
  return invoke('git_commit', { repoRoot, message, paths });
}

/** 合并分支到当前分支（--no-ff -S）。 */
export function gitMerge(repoRoot: string, branch: string): Promise<GitOpResult> {
  return invoke('git_merge', { repoRoot, branch });
}

/** cherry-pick 一个提交（-S）。 */
export function gitCherryPick(repoRoot: string, oid: string): Promise<GitOpResult> {
  return invoke('git_cherry_pick', { repoRoot, oid });
}

/** revert 一个提交（-S）。 */
export function gitRevert(repoRoot: string, oid: string): Promise<GitOpResult> {
  return invoke('git_revert', { repoRoot, oid });
}

/** checkout 分支/提交（force=丢弃冲突改动，须二次确认）。 */
export function gitCheckout(repoRoot: string, target: string, force = false): Promise<null> {
  return invoke('git_checkout', { repoRoot, target, force });
}

/** 在指定提交（null=HEAD）创建分支，可选同时切过去。 */
export function gitCreateBranch(
  repoRoot: string,
  name: string,
  targetOid: string | null = null,
  checkout = false,
): Promise<null> {
  return invoke('git_create_branch', { repoRoot, name, targetOid, checkout });
}

/** 删除本地分支。 */
export function gitDeleteBranch(repoRoot: string, name: string): Promise<null> {
  return invoke('git_delete_branch', { repoRoot, name });
}

/** reset 到某提交（hard 须 confirmHard=true）。 */
export function gitReset(
  repoRoot: string,
  targetOid: string,
  mode: ResetMode,
  confirmHard = false,
): Promise<null> {
  return invoke('git_reset', { repoRoot, targetOid, mode, confirmHard });
}

/** 创建 tag（message=附注 tag，null=轻量 tag；targetOid null=HEAD）。 */
export function gitTagCreate(
  repoRoot: string,
  name: string,
  targetOid: string | null = null,
  message: string | null = null,
): Promise<null> {
  return invoke('git_tag_create', { repoRoot, name, targetOid, message });
}

/** 删除 tag（短名）。 */
export function gitTagDelete(repoRoot: string, name: string): Promise<null> {
  return invoke('git_tag_delete', { repoRoot, name });
}

/** 暂存当前改动（含未跟踪）。 */
export function gitStashSave(repoRoot: string, message: string): Promise<null> {
  return invoke('git_stash_save', { repoRoot, message });
}

/** 恢复并删除指定 stash。 */
export function gitStashPop(repoRoot: string, index: number): Promise<null> {
  return invoke('git_stash_pop', { repoRoot, index });
}

/** 删除指定 stash（不恢复）。 */
export function gitStashDrop(repoRoot: string, index: number): Promise<null> {
  return invoke('git_stash_drop', { repoRoot, index });
}

/** 列出全部 stash。 */
export function gitStashList(repoRoot: string): Promise<StashEntry[]> {
  return invoke('git_stash_list', { repoRoot });
}

/** 中止进行中的 merge/cherry-pick/revert，还原到操作前（冲突卡死时的安全出口）。 */
export function gitAbortOp(repoRoot: string): Promise<null> {
  return invoke('git_abort_op', { repoRoot });
}

// ── 远程操作（W4，SSH）。进度走 Channel（invokeStreamed 自动塞 channel 参数）──────────────

/** fetch 远程（默认 refspec 更新 refs/remotes/<remote>/*）。 */
export function gitFetch(
  repoRoot: string,
  remote: string,
  onProgress: (p: GitProgress) => void,
): Promise<null> {
  return invokeStreamed('git_fetch', { repoRoot, remote }, onProgress);
}

/** push 本地分支到远程同名分支。 */
export function gitPush(
  repoRoot: string,
  remote: string,
  branch: string,
  onProgress: (p: GitProgress) => void,
): Promise<null> {
  return invokeStreamed('git_push', { repoRoot, remote, branch }, onProgress);
}

/** pull = fetch + merge_analysis（up-to-date/fast-forward 自动；分叉返回 diverged）。 */
export function gitPull(
  repoRoot: string,
  remote: string,
  branch: string,
  onProgress: (p: GitProgress) => void,
): Promise<PullOutcome> {
  return invokeStreamed('git_pull', { repoRoot, remote, branch }, onProgress);
}

/** clone 到 dest 目录，返回工作区路径。 */
export function gitClone(
  url: string,
  dest: string,
  onProgress: (p: GitProgress) => void,
): Promise<string> {
  return invokeStreamed('git_clone', { url, dest }, onProgress);
}
