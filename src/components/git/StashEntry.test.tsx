import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ list: vi.fn().mockResolvedValue([
  { index: 0, oid: 'new-stash', message: '最近的笔记修改' },
  { index: 1, oid: 'selected-stash', message: '待恢复的旧稿' },
]) }));
vi.mock('../../ipc/git', () => ({ gitStashList: api.list }));
vi.mock('../../editor/gitActions', () => ({ refreshGitAll: vi.fn(), commitChanges: vi.fn(), stashChanges: vi.fn(), fetchRemote: vi.fn(), pullCurrent: vi.fn(), pushCurrent: vi.fn() }));
vi.mock('react-resizable-panels', () => ({ Group: ({ children }: { children: ReactNode }) => <div>{children}</div>, Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>, Separator: () => null }));
vi.mock('./BranchFilter', () => ({ default: () => null }));
vi.mock('./BranchManager', () => ({ default: () => null }));
vi.mock('./IssuePanel', () => ({ default: () => null }));
vi.mock('./PrDetailPanel', () => ({ default: () => null }));
vi.mock('./PullRequestPanel', () => ({ default: () => null }));
vi.mock('./RepoSettings', () => ({ default: () => null }));
vi.mock('./RebaseControls', () => ({ default: () => null }));
vi.mock('./graph/CommitGraphList', () => ({ default: () => null }));
vi.mock('./CommitDetailPanel', () => ({ default: () => null }));
vi.mock('./FileDiffPanel', () => ({ default: () => null }));

import { useGitStore } from '../../stores/useGitStore';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { useVaultStore } from '../../stores/useVaultStore';
import GitGraphView from './GitGraphView';

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vault: { root: '/repo', repoRoot: '/repo', name: 'repo' } });
  useGitStore.setState({ repoRoot: '/repo' });
  useGitGraphStore.setState({ leftMode: 'graph', commits: [], loading: false, remoteBusy: null });
});

it('现有 Git 页面可以查看全部暂存记录并选择具体记录恢复或删除', async () => {
  render(<GitGraphView />);
  fireEvent.click(screen.getByRole('button', { name: '暂存记录' }));
  expect(await screen.findByText('待恢复的旧稿')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: '恢复并移除' })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: '删除记录' })).toHaveLength(2);
  expect(api.list).toHaveBeenCalledWith('/repo');
});
