import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { GitRebaseStatus } from '../../types/git';

const actions = vi.hoisted(() => ({ continue: vi.fn(), skip: vi.fn(), abort: vi.fn(), cancel: vi.fn(), commit: vi.fn() }));
vi.mock('../../editor/gitRebaseActions', () => ({ continueRebase: actions.continue, skipRebaseCommit: actions.skip, abortRebase: actions.abort, cancelRebaseExecution: actions.cancel, commitPendingRebase: actions.commit }));

import { useGitStore } from '../../stores/useGitStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useGitRebaseStore } from '../../stores/useGitRebaseStore';
import { captureGitWorktreeScope } from '../../editor/gitWorktreeMutation';
import RebaseControls from './RebaseControls';

const paused: GitRebaseStatus = { inProgress: true, headOid: 'onto', branch: 'topic', originalHead: 'original', onto: 'onto', currentCommit: 'pick', step: 1, total: 2, conflicts: ['note.md'], needsCommit: false, source: 'existing' };

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vault: { root: '/repo', repoRoot: '/repo', name: 'repo' } });
  useGitStore.setState({ repoRoot: '/repo' });
  useGitRebaseStore.setState({ scope: captureGitWorktreeScope(), status: paused, busy: false, loading: false, cancelling: false, error: null, outcome: 'paused', requestId: null, load: vi.fn().mockResolvedValue(undefined) });
});

it('外部冲突序列显示原签名策略，阻止未解决时继续并保留跳过和中止入口', () => {
  render(<RebaseControls />);
  expect(screen.getByText(/沿用原签名设置/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '继续变基' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '跳过当前提交' }));
  fireEvent.click(screen.getByRole('button', { name: '中止变基' }));
  expect(actions.skip).toHaveBeenCalledOnce();
  expect(actions.abort).toHaveBeenCalledOnce();
});

it('签名恢复需要明确提交暂存结果，不把普通继续伪装成恢复成功', () => {
  useGitRebaseStore.setState({ status: { ...paused, conflicts: [], needsCommit: true }, outcome: 'failed', error: 'signer unavailable' });
  render(<RebaseControls />);
  expect(screen.getByRole('alert')).toHaveTextContent('signer unavailable');
  expect(screen.getByRole('button', { name: '继续变基' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '提交暂存结果并继续' }));
  expect(actions.commit).toHaveBeenCalledOnce();
  expect(actions.continue).not.toHaveBeenCalled();
});

it('执行中只请求停止执行，换工作区后旧序列不再提供可点击操作', () => {
  useGitRebaseStore.setState({ busy: true, requestId: 'job' });
  render(<RebaseControls />);
  fireEvent.click(screen.getByRole('button', { name: '停止执行' }));
  expect(actions.cancel).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: '中止变基' })).not.toBeInTheDocument();
  act(() => {
    useVaultStore.setState({ vault: { root: '/other', repoRoot: '/other', name: 'other' } });
    useGitStore.setState({ repoRoot: '/other' });
  });
  expect(screen.queryByRole('button', { name: '停止执行' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('正在读取变基状态');
});
