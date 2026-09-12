import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { StashEntry } from '../types/git';

const io = vi.hoisted(() => ({ list: vi.fn(), pop: vi.fn(), drop: vi.fn(), save: vi.fn(), confirm: vi.fn(), boundary: vi.fn() }));
vi.mock('../ipc/git', () => ({ gitStashList: io.list, gitStashPop: io.pop, gitStashDrop: io.drop, gitStashSave: io.save, gitStatus: vi.fn(), gitBranchList: vi.fn(), gitLog: vi.fn(), gitRefs: vi.fn(), gitDiff: vi.fn(), ghPrDiff: vi.fn() }));
vi.mock('../stores/useConfirmStore', () => ({ confirmDestructive: io.confirm }));
vi.mock('./gitWorktreeMutation', async (original) => ({ ...await original<typeof import('./gitWorktreeMutation')>(), runGitWorktreeMutation: io.boundary }));

import { captureGitWorktreeScope } from './gitWorktreeMutation';
import { deleteStash, restoreStash } from './gitStashActions';
import { useGitStashStore } from '../stores/useGitStashStore';
import { useGitStore } from '../stores/useGitStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { useToastStore } from '../stores/useToastStore';

const selected: StashEntry = { index: 1, oid: 'selected-oid', message: '指定的旧稿' };

beforeEach(() => {
  io.list.mockReset().mockResolvedValue([selected]);
  io.pop.mockReset().mockResolvedValue(null);
  io.drop.mockReset().mockResolvedValue(null);
  io.save.mockReset().mockResolvedValue(null);
  io.confirm.mockReset().mockResolvedValue(true);
  io.boundary.mockReset().mockImplementation(async (_scope: unknown, write: () => Promise<unknown>) => ({ kind: 'executed', value: await write() }));
  useVaultStore.setState({ vault: { root: '/repo', repoRoot: '/repo', name: 'repo' } });
  useGitStore.setState({ repoRoot: '/repo', status: { branch: 'topic', files: [] } });
  useGitStashStore.setState(useGitStashStore.getInitialState(), true);
  useWorkbenchStore.setState({ centralView: 'gitGraph' });
});

afterEach(() => {
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
});

it('恢复指定记录时传递其索引和身份，并经过工作树边界后刷新真实列表', async () => {
  const scope = captureGitWorktreeScope()!;
  io.list.mockResolvedValue([]);
  expect(await restoreStash(scope, selected)).toBe(true);
  expect(io.boundary).toHaveBeenCalledWith(scope, expect.any(Function));
  expect(io.pop).toHaveBeenCalledWith('/repo', 1, 'selected-oid');
  expect(useGitStashStore.getState().entries).toEqual([]);
});

it('删除指定记录只删除对应引用，等待确认期间切库则不执行', async () => {
  const scope = captureGitWorktreeScope()!;
  let approve!: (value: boolean) => void;
  io.confirm.mockReturnValue(new Promise<boolean>((resolve) => { approve = resolve; }));
  const pending = deleteStash(scope, selected);
  useVaultStore.setState({ vault: { root: '/other', repoRoot: '/other', name: 'other' } });
  useGitStore.setState({ repoRoot: '/other' });
  approve(true);
  expect(await pending).toBe(false);
  expect(io.drop).not.toHaveBeenCalled();
  expect(io.boundary).not.toHaveBeenCalled();
});

it('确认删除后把记录身份传给原仓库，不保存或改写编辑正文', async () => {
  expect(await deleteStash(captureGitWorktreeScope()!, selected)).toBe(true);
  expect(io.drop).toHaveBeenCalledWith('/repo', 1, 'selected-oid');
  expect(io.boundary).not.toHaveBeenCalled();
});

it('恢复冲突后仍显示保留的暂存记录和错误，并进入冲突处理', async () => {
  io.pop.mockRejectedValue(new Error('恢复存在冲突，暂存记录保留'));
  useGitStore.setState({ status: { branch: 'topic', files: [{ path: 'note.md', status: 'conflicted', staged: true, unstaged: true }] } });
  expect(await restoreStash(captureGitWorktreeScope()!, selected)).toBe(false);
  expect(useGitStashStore.getState().entries).toEqual([selected]);
  expect(useGitStashStore.getState().error).toBe('恢复存在冲突，暂存记录保留');
  expect(useWorkbenchStore.getState().centralView).toBe('mergeResolve');
});

it('旧仓库暂存列表迟到时不能替换新工作区的列表', async () => {
  let finish!: (entries: StashEntry[]) => void;
  io.list.mockImplementation((root: string) => root === '/repo' ? new Promise<StashEntry[]>((resolve) => { finish = resolve; }) : Promise.resolve([]));
  const pending = useGitStashStore.getState().load(captureGitWorktreeScope());
  const other = { root: '/other', repoRoot: '/other', name: 'other' };
  useVaultStore.setState({ vault: other });
  useGitStore.setState({ repoRoot: '/other' });
  await useGitStashStore.getState().load(captureGitWorktreeScope());
  finish([selected]);
  await pending;
  expect(useGitStashStore.getState().scope?.vault).toBe(other);
  expect(useGitStashStore.getState().entries).toEqual([]);
});
