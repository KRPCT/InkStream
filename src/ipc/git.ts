import { invoke, invokeStreamed } from './invoke';
import type {
  BranchInfo,
  Comment,
  CommitInfo,
  DiffTarget,
  FileDiff,
  GitOpResult,
  GitProgress,
  GitRef,
  GitStatus,
  Issue,
  MergeMethod,
  MergeResult,
  PullOutcome,
  PullRequest,
  ResetMode,
  Review,
  ReviewEvent,
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

/** 提交历史（拓扑 + 时间序，分页）。refs 空 = 全部分支；非空 = 仅这些分支（W5 Filter Branches）。 */
export function gitLog(repoRoot: string, refs: string[] = [], skip = 0, limit = 100): Promise<CommitInfo[]> {
  return invoke('git_log', { repoRoot, refs, skip, limit });
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

// ── GitHub 登录（簇④，Personal Access Token 存 OS 凭据库）──────────────────────

/** 登录：保存 GitHub Personal Access Token（HTTPS 同步用）。 */
export function gitLoginGithub(token: string): Promise<null> {
  return invoke('git_login_github', { token });
}

/** 登出：清除 token。 */
export function gitLogoutGithub(): Promise<null> {
  return invoke('git_logout_github', undefined);
}

/** 是否已登录（token 存在；token 本身不回传）。 */
export function gitGithubStatus(): Promise<boolean> {
  return invoke('git_github_status', undefined);
}

// ── GitHub PR 流程（GIT-07，REST API 走 Rust；owner/repo 由 origin 远程解析）────────────

/** 列出仓库的开放 PR。 */
export function ghPrList(repoRoot: string): Promise<PullRequest[]> {
  return invoke('gh_pr_list', { repoRoot });
}

/** 新建 PR：head（来源分支）→ base（目标分支）。 */
export function ghPrCreate(
  repoRoot: string,
  title: string,
  body: string,
  base: string,
  head: string,
): Promise<PullRequest> {
  return invoke('gh_pr_create', { repoRoot, title, body, base, head });
}

/** 合并 PR（merge/squash/rebase）。 */
export function ghPrMerge(
  repoRoot: string,
  prNumber: number,
  method: MergeMethod,
): Promise<MergeResult> {
  return invoke('gh_pr_merge', { repoRoot, number: prNumber, method });
}

// ── GitHub Issue / 评论 / PR diff / review（Phase 11 GH-02/03，REST 走 Rust）────────────

/** PR 逐文件结构化 diff（复用 FileDiff → DiffHunkView 渲染）。 */
export function ghPrDiff(repoRoot: string, prNumber: number): Promise<FileDiff[]> {
  return invoke('gh_pr_diff', { repoRoot, number: prNumber });
}

/** 列出 PR 的 review。 */
export function ghPrReviews(repoRoot: string, prNumber: number): Promise<Review[]> {
  return invoke('gh_pr_reviews', { repoRoot, number: prNumber });
}

/** 提交 PR review（approve / request-changes / comment）。 */
export function ghPrReviewCreate(
  repoRoot: string,
  prNumber: number,
  event: ReviewEvent,
  body: string,
): Promise<Review> {
  return invoke('gh_pr_review_create', { repoRoot, number: prNumber, event, body });
}

/** 列出仓库 Issue（state ∈ open|closed|all）。 */
export function ghIssueList(repoRoot: string, state: string): Promise<Issue[]> {
  return invoke('gh_issue_list', { repoRoot, state });
}

/** 新建 Issue。 */
export function ghIssueCreate(repoRoot: string, title: string, body: string): Promise<Issue> {
  return invoke('gh_issue_create', { repoRoot, title, body });
}

/** 列出 issue/PR 评论（PR number 即 issue number）。 */
export function ghCommentList(repoRoot: string, number: number): Promise<Comment[]> {
  return invoke('gh_comment_list', { repoRoot, number });
}

/** 给 issue/PR 发表评论。 */
export function ghCommentCreate(repoRoot: string, number: number, body: string): Promise<Comment> {
  return invoke('gh_comment_create', { repoRoot, number, body });
}

// ── gh CLI 备用登录（Phase 11 GH-01，token 由 Rust 取并存 keyring，不出 Rust）──────────

/** 是否检测到 gh CLI 且已在 github.com 登录。 */
export function ghCliStatus(): Promise<boolean> {
  return invoke('gh_cli_status', undefined);
}

/** 用 gh CLI 一键登录（取其 token 存入 keyring）。 */
export function gitLoginGithubGh(): Promise<null> {
  return invoke('git_login_github_gh', undefined);
}

// ── prose 三向合并冲突解决（Phase 12 DIFF-03）──────────────────────────────

/** 读冲突文件工作区内容（含 git 合并标记）。 */
export function gitReadConflict(repoRoot: string, path: string): Promise<string> {
  return invoke('git_read_conflict', { repoRoot, path });
}

/** 写回解决后内容并 git add 标记 resolved。 */
export function gitResolveConflict(repoRoot: string, path: string, content: string): Promise<null> {
  return invoke('git_resolve_conflict', { repoRoot, path, content });
}
