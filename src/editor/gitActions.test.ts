import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #2 git 全局状态同步回归：GitGraph 自身的刷新入口（刷新按钮 / 进入视图）必须同时刷新
 * 状态栏 store（useGitStore：分支 + 脏标记）与图谱 store（useGitGraphStore：log + refs），
 * 否则左下角状态栏冻结在旧分支/旧状态（watcher 跳过 .git/* 不会补刷）。
 */

const gitStatus = vi.fn().mockResolvedValue({
  branch: 'feat/x',
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
});
const gitBranchList = vi.fn().mockResolvedValue([]);
const gitLog = vi.fn().mockResolvedValue([]);
const gitRefs = vi.fn().mockResolvedValue([]);
const gitDiff = vi.fn().mockResolvedValue([]);
const gitCommit = vi.fn().mockResolvedValue(undefined);
const gitFetch = vi.fn().mockResolvedValue(undefined);
const prompt = vi.hoisted(() => ({ input: vi.fn() }));
vi.mock('../stores/usePromptStore', () => ({ promptInput: prompt.input }));
vi.mock('./gitWorktreeMutation', async (load) => {
  const actual = await load<typeof import('./gitWorktreeMutation')>();
  return { ...actual, runGitWorktreeMutation: vi.fn(async (_scope: unknown, write: () => Promise<unknown>) => ({ kind: 'executed', value: await write() })) };
});

vi.mock('../ipc/git', () => ({
  gitStatus: (...a: unknown[]) => gitStatus(...a),
  gitBranchList: (...a: unknown[]) => gitBranchList(...a),
  gitLog: (...a: unknown[]) => gitLog(...a),
  gitRefs: (...a: unknown[]) => gitRefs(...a),
  gitDiff: (...a: unknown[]) => gitDiff(...a),
  gitCommit: (...a: unknown[]) => gitCommit(...a),
  gitFetch: (...a: unknown[]) => gitFetch(...a),
}));

const { refreshGitAll, commitChanges, fetchRemote } = await import('./gitActions');
const { useGitStore } = await import('../stores/useGitStore');
const { useGitGraphStore } = await import('../stores/useGitGraphStore');
const { useVaultStore } = await import('../stores/useVaultStore');
const { useWorkbenchStore } = await import('../stores/useWorkbenchStore');

beforeEach(() => {
  vi.clearAllMocks();
  useGitStore.setState({ repoRoot: '/repo', status: null, branches: [] });
  useVaultStore.setState({ vault: { root: '/repo', repoRoot: '/repo', name: 'repo' } });
  useGitGraphStore.setState({ repoRoot: null, commits: [], refs: [] });
  useWorkbenchStore.setState({ centralView: 'editor' });
});

it('旧仓库 fetch 迟到完成不能把新工作区图谱切回旧仓库', async () => {
  let finish!: () => void;
  gitFetch.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  const pending = fetchRemote();
  useVaultStore.setState({ vault: { root: '/repo-b', repoRoot: '/repo-b', name: 'b' } });
  useGitStore.setState({ repoRoot: '/repo-b' });
  useGitGraphStore.setState({ repoRoot: '/repo-b', remoteBusy: 'B workspace operation' });
  useWorkbenchStore.setState({ centralView: 'gitGraph' });
  finish();
  await pending;
  expect(useGitGraphStore.getState().repoRoot).toBe('/repo-b');
  expect(useGitGraphStore.getState().remoteBusy).toBe('B workspace operation');
  expect(gitRefs).not.toHaveBeenCalledWith('/repo');
});

it('旧工作区提交弹窗的结果不能提交后来打开的工作区', async () => {
  let reply!: (value: string) => void;
  prompt.input.mockReturnValue(new Promise<string>((resolve) => { reply = resolve; }));
  const pending = commitChanges();
  useVaultStore.setState({ vault: { root: '/repo-b', repoRoot: '/repo-b', name: 'b' } });
  useGitStore.setState({ repoRoot: '/repo-b' });
  reply('feat: old workspace message');
  await pending;
  expect(gitCommit).not.toHaveBeenCalled();
});

describe('refreshGitAll', () => {
  it('同时刷新状态栏 store（status+branches）与图谱 store（log+refs）', async () => {
    await refreshGitAll('/repo');
    // 状态栏 store
    expect(gitStatus).toHaveBeenCalledWith('/repo');
    expect(gitBranchList).toHaveBeenCalledWith('/repo');
    // 图谱 store
    expect(gitLog).toHaveBeenCalled();
    expect(gitRefs).toHaveBeenCalledWith('/repo');
    // 状态栏拿到新分支（不再冻结）
    expect(useGitStore.getState().status?.branch).toBe('feat/x');
  });
});
