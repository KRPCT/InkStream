import { gitCancelRebase, gitRebase, gitRebaseStatus } from '../ipc/git';
import { confirmDestructive } from '../stores/useConfirmStore';
import { useGitRebaseStore } from '../stores/useGitRebaseStore';
import { promptInput } from '../stores/usePromptStore';
import { showToast } from '../stores/useToastStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import type { GitRebaseAction, GitRebaseResult, GitRebaseStatus } from '../types/git';
import { captureGitWorktreeScope, isCurrentGitScope, runGitWorktreeMutation, type GitWorktreeScope } from './gitWorktreeMutation';

let active: { scope: GitWorktreeScope; id: string; controller: AbortController } | null = null;

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function run(scope: GitWorktreeScope, action: GitRebaseAction): Promise<GitRebaseResult | null> {
  if (!isCurrentGitScope(scope) || active) return null;
  const id = crypto.randomUUID();
  const controller = new AbortController();
  active = { scope, id, controller };
  useGitRebaseStore.setState({ scope, busy: true, cancelling: false, loading: false, requestId: id, error: null, outcome: null });
  try {
    const result = await runGitWorktreeMutation(scope, () => gitRebase(scope.repoRoot, id, action), {
      signal: controller.signal, preserveDirty: action.kind === 'abort' || action.kind === 'skip',
    });
    if (!isCurrentGitScope(scope)) return null;
    if (result.kind === 'blocked') {
      if (controller.signal.aborted) useGitRebaseStore.setState({ error: '已取消，Git 操作未开始。', outcome: 'cancelled' });
      return null;
    }
    useGitRebaseStore.setState({ status: result.value.status, error: result.value.error, outcome: result.value.outcome });
    if (result.value.status.inProgress && result.value.status.conflicts.length > 0) useWorkbenchStore.getState().setCentralView('mergeResolve');
    return result.value;
  } catch (error) {
    if (isCurrentGitScope(scope)) {
      try {
        const status = await gitRebaseStatus(scope.repoRoot);
        if (isCurrentGitScope(scope)) useGitRebaseStore.setState({ status });
      } catch { /* Preserve the last actual state; the error remains actionable. */ }
      if (isCurrentGitScope(scope)) {
        useGitRebaseStore.setState({ error: message(error), outcome: 'failed' });
        showToast('error', `变基操作失败：${message(error)}`);
      }
    }
    return null;
  } finally {
    if (active?.id === id) active = null;
    if (useGitRebaseStore.getState().requestId === id) useGitRebaseStore.setState({ busy: false, cancelling: false, requestId: null });
  }
}

async function start(scope: GitWorktreeScope, upstream: string): Promise<void> {
  if (!isCurrentGitScope(scope) || active) return;
  let status: GitRebaseStatus;
  try { status = await gitRebaseStatus(scope.repoRoot); }
  catch (error) { if (isCurrentGitScope(scope)) showToast('error', `无法读取变基状态：${message(error)}`); return; }
  if (!isCurrentGitScope(scope)) return;
  useGitRebaseStore.setState({ scope, status, error: null });
  if (status.inProgress) {
    useWorkbenchStore.getState().setCentralView('mergeResolve');
    showToast('warning', '已有变基尚未结束，请先继续、跳过或中止。');
    return;
  }
  const approved = await confirmDestructive({
    title: '变基当前分支',
    body: `将「${status.branch ?? '当前分支'}」的提交重放到「${upstream}」，会重写本地提交历史。未保存文档会先保存；已有未提交改动仍由 Git 检查。`,
    confirmLabel: '开始变基',
  });
  if (approved && isCurrentGitScope(scope)) await run(scope, { kind: 'start', upstream });
}

export async function rebaseCurrentOnto(upstream: string): Promise<void> {
  const scope = captureGitWorktreeScope();
  if (scope) await start(scope, upstream);
}

export async function requestRebase(): Promise<void> {
  const scope = captureGitWorktreeScope();
  if (!scope) { showToast('warning', '请先打开一个 Git 工作区。'); return; }
  const upstream = await promptInput({ title: '本地变基', label: '目标分支或已有的远程跟踪引用', placeholder: 'main / origin/main', confirmLabel: '下一步' });
  if (upstream?.trim() && isCurrentGitScope(scope)) await start(scope, upstream.trim());
}

export async function continueRebase(): Promise<void> {
  const scope = captureGitWorktreeScope();
  if (scope) await run(scope, { kind: 'continue' });
}

/** Git can require an explicit commit after a failed signer; use its public commit + continue flow. */
export async function commitPendingRebase(): Promise<void> {
  const scope = captureGitWorktreeScope();
  if (!scope || active) return;
  let status: GitRebaseStatus;
  try { status = await gitRebaseStatus(scope.repoRoot); }
  catch (error) { if (isCurrentGitScope(scope)) showToast('error', message(error)); return; }
  if (!isCurrentGitScope(scope) || !status.needsCommit || !status.currentCommit) return;
  const approved = await confirmDestructive({
    title: '提交暂存结果并继续',
    body: `使用正在重放的提交 ${status.currentCommit.slice(0, 8)} 的作者与提交信息，提交当前暂存内容，再继续变基。沿用该序列已有的签名设置。`,
    confirmLabel: '提交并继续',
  });
  if (approved && isCurrentGitScope(scope)) await run(scope, { kind: 'commit-continue', commit: status.currentCommit });
}

export async function skipRebaseCommit(): Promise<void> {
  const scope = captureGitWorktreeScope();
  if (!scope || active) return;
  const approved = await confirmDestructive({ title: '跳过当前提交', body: '跳过当前正在重放的提交，并继续处理后续提交。未保存的编辑会保留，避免覆盖 Git 处理后的文件。', confirmLabel: '跳过提交' });
  if (approved && isCurrentGitScope(scope)) await run(scope, { kind: 'skip' });
}

export async function abortRebase(): Promise<boolean> {
  const scope = captureGitWorktreeScope();
  if (!scope || active) return false;
  const approved = await confirmDestructive({ title: '中止变基', body: '恢复到变基前的分支与提交，当前工作树中的变基结果会被撤回。未保存的编辑仍会保留供你处理。', confirmLabel: '中止变基' });
  if (!approved || !isCurrentGitScope(scope)) return false;
  return (await run(scope, { kind: 'abort' }))?.outcome === 'aborted';
}

export async function cancelRebaseExecution(): Promise<void> {
  const job = active;
  if (!job || !isCurrentGitScope(job.scope) || job.controller.signal.aborted) return;
  job.controller.abort();
  useGitRebaseStore.setState({ cancelling: true });
  try { await gitCancelRebase(job.scope.repoRoot, job.id); }
  catch (error) { if (isCurrentGitScope(job.scope)) useGitRebaseStore.setState({ error: `停止请求失败：${message(error)}` }); }
}
