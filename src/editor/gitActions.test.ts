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

vi.mock('../ipc/git', () => ({
  gitStatus: (...a: unknown[]) => gitStatus(...a),
  gitBranchList: (...a: unknown[]) => gitBranchList(...a),
  gitLog: (...a: unknown[]) => gitLog(...a),
  gitRefs: (...a: unknown[]) => gitRefs(...a),
  gitDiff: (...a: unknown[]) => gitDiff(...a),
}));

const { refreshGitAll } = await import('./gitActions');
const { useGitStore } = await import('../stores/useGitStore');
const { useGitGraphStore } = await import('../stores/useGitGraphStore');

beforeEach(() => {
  vi.clearAllMocks();
  useGitStore.setState({ repoRoot: '/repo', status: null, branches: [] });
  useGitGraphStore.setState({ repoRoot: null, commits: [], refs: [] });
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
