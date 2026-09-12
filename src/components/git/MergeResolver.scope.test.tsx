import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { GitFileStatus, GitRebaseStatus } from '../../types/git';

const io = vi.hoisted(() => ({ read: vi.fn(), snapshot: vi.fn(), resolve: vi.fn().mockResolvedValue(null) }));
vi.mock('../../ipc/git', () => ({
  gitStatus: vi.fn().mockResolvedValue(null), gitBranchList: vi.fn().mockResolvedValue([]),
  gitRebaseStatus: vi.fn().mockResolvedValue({ inProgress: false, source: null, conflicts: [] }),
}));
vi.mock('../../ipc/gitConflict', () => ({ gitConflictSnapshot: io.snapshot, gitConflictText: io.read, gitSaveConflict: io.resolve }));
vi.mock('../../editor/gitActions', () => ({ abortOp: vi.fn().mockResolvedValue(false) }));

import { useGitStore } from '../../stores/useGitStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useGitRebaseStore } from '../../stores/useGitRebaseStore';
import { captureGitWorktreeScope } from '../../editor/gitWorktreeMutation';
import MergeResolver from './MergeResolver';

beforeEach(() => {
  io.snapshot.mockReset().mockResolvedValue({ baseline: { workingOid: 'working', stages: [null, null, null], headOid: 'head', operation: 'merge' }, markerError: null, conflictCount: 1 });
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
  expect(io.snapshot).toHaveBeenCalledTimes(2);
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

it('损坏标记保留原文并阻止写入和暂存', async () => {
  io.read.mockResolvedValue('<<<<<<< HEAD\n正文缺少结束标记\n');
  render(<MergeResolver />);
  expect(await screen.findByRole('alert')).toHaveTextContent('未完整结束');
  expect(screen.getByLabelText('完整冲突原文')).toHaveTextContent('正文缺少结束标记');
  const save = screen.getByRole('button', { name: '保存并标记解决' });
  expect(save).toBeDisabled(); fireEvent.click(save);
  expect(io.resolve).not.toHaveBeenCalled();
});

it('diff3 共同基线可见，必须明确采纳后才允许保存', async () => {
  io.read.mockResolvedValue('<<<<<<< HEAD\r\nours\r\n||||||| base\r\ncommon base\r\n=======\r\ntheirs\r\n>>>>>>> topic\r\n');
  render(<MergeResolver />);
  await screen.findByText('共同基线（diff3）');
  expect(screen.getByLabelText('当前冲突共同基线')).toHaveTextContent('common base');
  expect(screen.getByRole('button', { name: '保存并标记解决' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '采纳本方' }));
  expect(screen.getByRole('button', { name: '保存并标记解决' })).toBeEnabled();
});
