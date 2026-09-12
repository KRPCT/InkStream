import { gitCancelOperation } from '../ipc/git';
import { useGitOperationStore } from '../stores/useGitOperationStore';
import { showToast } from '../stores/useToastStore';
import { isCurrentGitScope, type GitWorktreeScope } from './gitWorktreeMutation';

/** Started only after document/worktree admission. Keep busy until native cleanup returns. */
export async function runLocalGitOperation<T>(scope: GitWorktreeScope, label: string, run: (requestId: string) => Promise<T>): Promise<T> {
  if (useGitOperationStore.getState().current) throw new Error('本地 Git 操作仍在执行，请等待或先取消。');
  const current = { scope, requestId: crypto.randomUUID(), label, cancelling: false };
  useGitOperationStore.setState({ current });
  try { return await run(current.requestId); }
  finally {
    if (useGitOperationStore.getState().current?.requestId === current.requestId) useGitOperationStore.setState({ current: null });
  }
}

export async function cancelLocalGitOperation(): Promise<void> {
  const current = useGitOperationStore.getState().current;
  if (!current || current.cancelling || !isCurrentGitScope(current.scope)) return;
  useGitOperationStore.setState({ current: { ...current, cancelling: true } });
  try { await gitCancelOperation(current.scope.repoRoot, current.requestId); }
  catch (error) {
    if (useGitOperationStore.getState().current?.requestId === current.requestId) {
      useGitOperationStore.setState({ current: { ...current, cancelling: false } });
      showToast('error', `停止 Git 操作失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
