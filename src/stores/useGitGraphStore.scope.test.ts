import { beforeEach, expect, it, vi } from 'vitest';
import type { PullRequest } from '../types/git';
import type { GitComparePage } from '../types/gitCompare';
import type { GithubPrDiffPage } from '../types/githubPage';
const io = vi.hoisted(() => ({ diff: vi.fn(), log: vi.fn(), refs: vi.fn(), pr: vi.fn() }));
vi.mock('../ipc/git', () => ({ gitDiff: io.diff, gitLog: io.log, gitRefs: io.refs, gitStatus: vi.fn(), gitBranchList: vi.fn() }));
vi.mock('../ipc/gitCompare', () => ({ gitCommitFiles: io.diff }));
vi.mock('../ipc/githubPage', () => ({ githubPrDiffPage: io.pr }));
import { useGitGraphStore } from './useGitGraphStore';
import { useGitStore } from './useGitStore';
import { useVaultStore } from './useVaultStore';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
const pr: PullRequest = { number: 7, title: 'PR', body: '', state: 'open', draft: false, url: '', author: 'a', headRef: 'topic', baseRef: 'main' };
const page = (head: string): GithubPrDiffPage => ({ items: [], nextPage: 2, headOid: head, baseOid: 'base', webUrl: '', limited: false });
beforeEach(() => {
  useVaultStore.setState({ vault: null }); useGitStore.setState({ repoRoot: '/A' });
  useGitGraphStore.getState().clearRepository(); useGitGraphStore.setState({ repoRoot: '/A', leftMode: 'graph' });
  io.diff.mockReset(); io.log.mockReset(); io.refs.mockReset(); io.pr.mockReset();
});
it('同号 PR 的 A→B→A 晚结果也不能覆盖最新选择', async () => {
  const old = deferred<GithubPrDiffPage>(); io.pr.mockReturnValueOnce(old.promise).mockResolvedValue(page('latest'));
  useGitGraphStore.getState().selectPr(pr, '/A');
  useGitStore.setState({ repoRoot: '/B' });
  useGitGraphStore.getState().selectPr({ ...pr }, '/B');
  useGitStore.setState({ repoRoot: '/A' });
  useGitGraphStore.getState().selectPr({ ...pr }, '/A');
  await vi.waitFor(() => expect(useGitGraphStore.getState().prDiff?.headOid).toBe('latest'));
  old.resolve(page('stale')); await Promise.resolve();
  expect(useGitGraphStore.getState().prDiff?.headOid).toBe('latest');
});
it('共享 OID 的不同仓库不会回填旧提交 diff，切模式同时清退在途结果', async () => {
  const old = deferred<GitComparePage>(); io.diff.mockReturnValue(old.promise);
  useGitGraphStore.getState().selectCommit('shared-oid');
  useGitStore.setState({ repoRoot: '/B' }); useGitGraphStore.setState({ repoRoot: '/B' });
  useGitGraphStore.getState().setLeftMode('issues');
  old.resolve({ fromOid: 'parent', toOid: 'shared-oid', total: 1, next: null, files: [{ status: 'added', old: null, new: { commitOid: 'shared-oid', blobOid: 'blob', path: 'A.md', readable: true, byteLength: 1 } }] });
  await Promise.resolve();
  expect(useGitGraphStore.getState().commitFiles).toEqual([]);
  expect(useGitGraphStore.getState().filesLoading).toBe(false);
});

it('提交文件分页保留固定 OID，旧页晚结果不能覆盖新页', async () => {
  const old = deferred<GitComparePage>();
  io.diff.mockReturnValueOnce(old.promise).mockResolvedValue({ fromOid: 'parent', toOid: 'fixed', total: 101, next: null, files: [{ status: 'added', old: null, new: { commitOid: 'fixed', blobOid: 'blob', path: 'last.md', readable: true, byteLength: 1 } }] });
  useGitGraphStore.getState().selectCommit('fixed');
  useGitGraphStore.getState().loadCommitPage(100);
  await vi.waitFor(() => expect(useGitGraphStore.getState().selectedFile).toBe('last.md'));
  expect(io.diff).toHaveBeenLastCalledWith('/A', 'fixed', 100, null);
  old.resolve({ fromOid: 'parent', toOid: 'fixed', total: 101, next: 100, files: [] });
  await Promise.resolve();
  expect(useGitGraphStore.getState().selectedFile).toBe('last.md');
});
it('翻到 PR 下一页仍携带首屏固定提交，不采用移动后的分支', async () => {
  io.pr.mockResolvedValue(page('fixed'));
  useGitGraphStore.getState().selectPr(pr, '/A');
  await vi.waitFor(() => expect(useGitGraphStore.getState().prDiff?.headOid).toBe('fixed'));
  useGitGraphStore.getState().loadPrPage(2);
  expect(io.pr).toHaveBeenLastCalledWith('/A', 7, 2, 'fixed', 'base');
});
