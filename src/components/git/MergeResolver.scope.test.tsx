import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { GitFileStatus, GitRebaseStatus } from '../../types/git';

const io = vi.hoisted(() => ({ read: vi.fn(), resolve: vi.fn().mockResolvedValue(null) }));
vi.mock('../../ipc/git', () => ({
  gitReadConflict: io.read, gitResolveConflict: io.resolve,
  gitStatus: vi.fn().mockResolvedValue(null), gitBranchList: vi.fn().mockResolvedValue([]),
  gitRebaseStatus: vi.fn().mockResolvedValue({ inProgress: false, source: null, conflicts: [] }),
}));
vi.mock('../../editor/gitActions', () => ({ abortOp: vi.fn().mockResolvedValue(false) }));

import { useGitStore } from '../../stores/useGitStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useGitRebaseStore } from '../../stores/useGitRebaseStore';
import { captureGitWorktreeScope } from '../../editor/gitWorktreeMutation';
import MergeResolver from './MergeResolver';

beforeEach(() => {
  io.read.mockReset().mockResolvedValue('before\n<<<<<<< HEAD\nours A\n=======\ntheirs A\n>>>>>>> topic\nafter\n');
  io.resolve.mockClear();
  useVaultStore.setState({ vault: { root: '/repo-a', repoRoot: '/repo-a', name: 'a' } });
  useGitStore.setState({ repoRoot: '/repo-a', status: {
    branch: 'topic',
    files: ['a.md', 'b.md'].map((path): GitFileStatus => ({ path, status: 'conflicted', staged: false, unstaged: true })),
  } });
  useGitRebaseStore.setState({ scope: null, status: null, busy: false, loading: false, error: null, outcome: null, load: vi.fn().mockResolvedValue(undefined) });
});

it('同一路径进入下一重放提交后，旧段落立即失效并重新读取', async () => {
  const status: GitRebaseStatus = { inProgress: true, source: 'application', headOid: 'onto', branch: 'topic', originalHead: 'original', onto: 'onto', currentCommit: 'first', step: 1, total: 2, conflicts: ['a.md'], needsCommit: false };
  useGitRebaseStore.setState({ scope: captureGitWorktreeScope(), status });
  render(<MergeResolver />);
  await screen.findByText('1 处冲突');
  io.read.mockReturnValue(new Promise(() => {}));
  act(() => useGitRebaseStore.setState({ status: { ...status, currentCommit: 'second', step: 2 } }));
  expect(screen.getByRole('button', { name: '保存并标记解决' })).toBeDisabled();
  expect(io.read).toHaveBeenCalledTimes(2);
  expect(io.resolve).not.toHaveBeenCalled();
});

it('切到下一冲突文件但读取未完成时，不能把上一文件的段落写过去', async () => {
  render(<MergeResolver />);
  await screen.findByText('1 处冲突');
  io.read.mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: 'b.md' }));
  expect(screen.getByRole('button', { name: '保存并标记解决' })).toBeDisabled();
  expect(io.resolve).not.toHaveBeenCalled();
});

it('同名冲突文件换仓库后，新正文未读取前不能保存旧仓库选择', async () => {
  render(<MergeResolver />);
  await screen.findByText('1 处冲突');
  io.read.mockReturnValue(new Promise(() => {}));
  act(() => {
    useVaultStore.setState({ vault: { root: '/repo-b', repoRoot: '/repo-b', name: 'b' } });
    useGitStore.setState({ repoRoot: '/repo-b' });
  });
  expect(screen.getByRole('button', { name: '保存并标记解决' })).toBeDisabled();
  expect(io.resolve).not.toHaveBeenCalled();
});
