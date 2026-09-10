import { gitStashDrop, gitStashPop, gitStashSave } from '../ipc/git';
import { confirmDestructive } from '../stores/useConfirmStore';
import { useGitStashStore } from '../stores/useGitStashStore';
import { useGitGraphStore } from '../stores/useGitGraphStore';
import { useGitStore } from '../stores/useGitStore';
import { promptInput } from '../stores/usePromptStore';
import { showToast } from '../stores/useToastStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import type { StashEntry } from '../types/git';
import { captureGitWorktreeScope, isCurrentGitScope, runGitWorktreeMutation, type GitWorktreeScope } from './gitWorktreeMutation';

let nextRequest = 0;

async function mutate(scope: GitWorktreeScope, operation: () => Promise<unknown>, changesFiles: boolean): Promise<boolean> {
  const previous = useGitStashStore.getState();
  if (!isCurrentGitScope(scope) || (previous.busy && previous.scope?.vault === scope.vault && previous.scope.repoRoot === scope.repoRoot)) return false;
  const requestId = ++nextRequest;
  useGitStashStore.setState({ scope, busy: true, loading: false, requestId, error: null });
  let failure: string | null = null;
  try {
    if (changesFiles) {
      const result = await runGitWorktreeMutation(scope, operation);
      if (result.kind === 'blocked') { failure = '暂存操作尚未执行，请先处理文档保存或冲突。'; return false; }
    } else {
      // Removing a stash reference does not change editor files; native code holds the shared Git lease.
      await operation();
    }
    return isCurrentGitScope(scope);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    if (isCurrentGitScope(scope) && (useWorkbenchStore.getState().centralView !== 'gitGraph' || useGitGraphStore.getState().leftMode !== 'stashes')) showToast('error', failure);
    if (changesFiles && isCurrentGitScope(scope) && useGitStore.getState().status?.files.some((file) => file.status === 'conflicted')) {
      useWorkbenchStore.getState().setCentralView('mergeResolve');
    }
    return false;
  } finally {
    if (isCurrentGitScope(scope) && useGitStashStore.getState().requestId === requestId) {
      useGitStashStore.setState({ busy: false });
      await useGitStashStore.getState().load(scope);
      if (failure && isCurrentGitScope(scope) && useGitStashStore.getState().requestId === requestId) useGitStashStore.setState({ error: failure });
    }
  }
}

export async function stashChanges(): Promise<void> {
  const scope = captureGitWorktreeScope();
  if (!scope) return;
  const message = await promptInput({ title: '暂存改动', label: '备注（可留空）', placeholder: 'WIP', confirmLabel: '暂存' });
  if (message === null || !isCurrentGitScope(scope)) return;
  await mutate(scope, () => gitStashSave(scope.repoRoot, message), true);
}

export async function restoreStash(scope: GitWorktreeScope, entry: StashEntry): Promise<boolean> {
  return mutate(scope, () => gitStashPop(scope.repoRoot, entry.index, entry.oid), true);
}

export async function deleteStash(scope: GitWorktreeScope, entry: StashEntry): Promise<boolean> {
  if (!isCurrentGitScope(scope)) return false;
  const approved = await confirmDestructive({
    title: '删除暂存记录',
    body: `删除 stash@{${entry.index}}「${entry.message}」？这不会恢复其中的改动，删除后将无法从暂存列表取回。`,
    confirmLabel: '删除记录',
  });
  if (!approved || !isCurrentGitScope(scope)) return false;
  return mutate(scope, () => gitStashDrop(scope.repoRoot, entry.index, entry.oid), false);
}
