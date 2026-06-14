import { invoke } from './invoke';
import type { BranchInfo, CommitInfo, DiffTarget, FileDiff, GitStatus } from '../types/git';

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

/** 结构化 diff（工作区/暂存区/两 commit 间）。 */
export function gitDiff(repoRoot: string, target: DiffTarget): Promise<FileDiff[]> {
  return invoke('git_diff', { repoRoot, target });
}
