import { beforeEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ cancel: vi.fn().mockResolvedValue(true) }));
vi.mock('../ipc/git', () => ({ gitCancelOperation: io.cancel, gitStatus: vi.fn(), gitBranchList: vi.fn(), gitLog: vi.fn(), gitRefs: vi.fn() }));
import { runLocalGitOperation, cancelLocalGitOperation } from './gitLocalOperation';
import { captureGitWorktreeScope } from './gitWorktreeMutation';
import { useGitOperationStore } from '../stores/useGitOperationStore';
import { useGitStore } from '../stores/useGitStore';
import { useVaultStore } from '../stores/useVaultStore';

beforeEach(() => {
  io.cancel.mockClear();
  useGitOperationStore.setState({ current: null });
  useVaultStore.setState({ vault: { root: '/repo', repoRoot: '/repo', name: 'repo' } });
  useGitStore.setState({ repoRoot: '/repo' });
});
it('cancel binds the captured native request and stays busy until cleanup actually returns', async () => {
  let finish!: () => void;
  const result = new Promise<void>((resolve) => { finish = resolve; });
  const pending = runLocalGitOperation(captureGitWorktreeScope()!, '提交', () => result);
  const request = useGitOperationStore.getState().current!;
  await cancelLocalGitOperation();
  expect(io.cancel).toHaveBeenCalledWith('/repo', request.requestId);
  expect(useGitOperationStore.getState().current?.cancelling).toBe(true);
  finish(); await pending;
  expect(useGitOperationStore.getState().current).toBeNull();
});
it('a failed operation releases UI admission for a subsequent operation', async () => {
  const scope = captureGitWorktreeScope()!;
  await expect(runLocalGitOperation(scope, '提交', async () => { throw new Error('signer failed'); })).rejects.toThrow('signer failed');
  expect(useGitOperationStore.getState().current).toBeNull();
  await expect(runLocalGitOperation(scope, '提交', async () => 'saved')).resolves.toBe('saved');
});
