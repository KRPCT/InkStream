import { afterEach, expect, it, vi } from 'vitest';
import { useGitStore } from './useGitStore';
import { gitBranchList, gitStatus } from '../ipc/git';
vi.mock('../ipc/git', () => ({ gitStatus: vi.fn(), gitBranchList: vi.fn() }));
afterEach(() => { useGitStore.getState().setRepoRoot(null); vi.clearAllMocks(); });

it('a late status from the previous visit cannot replace a new visit to the same repository', async () => {
  const status = { branch: 'new', files: [] };
  let resolveOld!: (value: typeof status) => void;
  vi.mocked(gitStatus).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue(status);
  vi.mocked(gitBranchList).mockResolvedValue([]);
  useGitStore.getState().setRepoRoot('/a');
  useGitStore.getState().setRepoRoot('/b');
  useGitStore.getState().setRepoRoot('/a');
  await vi.waitFor(() => expect(useGitStore.getState().status).toEqual(status));
  resolveOld({ branch: 'old', files: [] });
  await Promise.resolve(); await Promise.resolve();
  expect(useGitStore.getState().status).toEqual(status);
  expect(useGitStore.getState().loading).toBe(false);
});
