import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Issue, PullRequest } from '../../types/git';
import type { GithubPage } from '../../types/githubPage';

const api = vi.hoisted(() => ({ issues: vi.fn(), pulls: vi.fn(), comments: vi.fn(), create: vi.fn(), merge: vi.fn(), diff: vi.fn() }));
vi.mock('../../ipc/githubPage', () => ({ githubIssuePage: api.issues, githubPrPage: api.pulls, githubCommentPage: api.comments, githubPrDiffPage: api.diff, githubPrLocalBase: async () => 'c'.repeat(40) }));
vi.mock('../../ipc/git', async (original) => ({ ...await original<typeof import('../../ipc/git')>(), ghIssueCreate: api.create, ghPrMerge: api.merge }));
import { useGitStore } from '../../stores/useGitStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import IssuePanel from './IssuePanel';
import PullRequestPanel from './PullRequestPanel';
import CommentThread from './CommentThread';
import PrFileDiffPanel from './PrFileDiffPanel';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
function issue(root: string, number = 7): Issue { return { number, title: `${root} 的问题`, body: `${root} 正文`, state: 'open', author: root, createdAt: '', updatedAt: '', url: `https://github.com/o/${root}/issues/${number}`, comments: 0 }; }
function pr(root: string): PullRequest { return { number: 7, title: `${root} 的 PR`, body: '', state: 'open', draft: false, author: root, url: `https://github.com/o/${root}/pull/7`, headRef: 'topic', baseRef: 'main', headOid: 'b'.repeat(40), baseOid: 'a'.repeat(40) }; }
beforeEach(() => {
  useVaultStore.setState({ vault: { root: '/A', repoRoot: '/A', name: 'A' } });
  useGitStore.setState({ repoRoot: '/A', branches: [] });
  useGitGraphStore.getState().clearRepository();
  api.issues.mockReset().mockImplementation(async (root: string) => ({ items: [issue(root)], nextPage: null }));
  api.pulls.mockReset().mockImplementation(async (root: string) => ({ items: [pr(root)], nextPage: null }));
  api.comments.mockReset().mockResolvedValue({ items: [], nextPage: null });
  api.create.mockReset(); api.merge.mockReset(); api.diff.mockReset().mockResolvedValue({ items: [], nextPage: null, headOid: 'b'.repeat(40), baseOid: 'a'.repeat(40), webUrl: '', limited: false });
});
afterEach(cleanup);

it('切库立即清退旧 Issue 详情，不能给 B 仓库配 A 的标题和评论编号', async () => {
  render(<IssuePanel />);
  fireEvent.click(await screen.findByRole('button', { name: /\/A 的问题/ }));
  expect(await screen.findByText('/A 正文')).toBeVisible();
  act(() => useGitStore.setState({ repoRoot: '/B' }));
  expect(screen.queryByText('/A 正文')).not.toBeInTheDocument();
  expect(api.comments).not.toHaveBeenCalledWith('/B', 7, expect.anything());
  fireEvent.click(await screen.findByRole('button', { name: /\/B 的问题/ }));
  await waitFor(() => expect(api.comments).toHaveBeenCalledWith('/B', 7, 1));
});

it('旧 PR 列表晚到不能覆盖新库，也不能把旧列表交给新库合并', async () => {
  const pending = deferred<GithubPage<PullRequest>>(); api.pulls.mockReturnValueOnce(pending.promise);
  render(<PullRequestPanel />);
  act(() => useGitStore.setState({ repoRoot: '/B' }));
  await screen.findByRole('button', { name: '/B 的 PR' });
  await act(async () => pending.resolve({ items: [pr('/A')], nextPage: null }));
  expect(screen.queryByRole('button', { name: '/A 的 PR' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '/B 的 PR' }));
  expect(useGitGraphStore.getState().selectedPrRepoRoot).toBe('/B');
  expect(api.diff).toHaveBeenCalledWith('/B', 7, 1, 'b'.repeat(40), 'a'.repeat(40));
  expect(api.merge).not.toHaveBeenCalled();
});

it('过滤后空页仍可翻到包含 Issue 的下一页，评论第 101 项也可达', async () => {
  api.issues.mockResolvedValueOnce({ items: [], nextPage: 2 }).mockResolvedValueOnce({ items: [issue('later', 101)], nextPage: null });
  const rendered = render(<IssuePanel />);
  await waitFor(() => expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByRole('button', { name: /later 的问题/ });
  expect(api.issues).toHaveBeenLastCalledWith('/A', 'open', 2);
  rendered.unmount();
  api.comments.mockResolvedValueOnce({ items: [], nextPage: 11 }).mockResolvedValueOnce({ items: [{ id: 101, author: 'author', body: '第101条评论', createdAt: '', url: '' }], nextPage: null });
  render(<CommentThread repoRoot="/A" number={7} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  await screen.findByText('第101条评论');
  expect(api.comments).toHaveBeenLastCalledWith('/A', 7, 11);
});

it('旧 Issue 创建完成不能清空新库输入，也不会再次提交', async () => {
  const pending = deferred<Issue>(); api.create.mockReturnValueOnce(pending.promise);
  render(<IssuePanel />);
  fireEvent.click(screen.getByTitle('新建 Issue'));
  fireEvent.change(screen.getByPlaceholderText('Issue 标题'), { target: { value: 'A 待提交' } });
  fireEvent.click(screen.getByRole('button', { name: '创建' }));
  act(() => useGitStore.setState({ repoRoot: '/B' }));
  fireEvent.click(screen.getByTitle('新建 Issue'));
  fireEvent.change(screen.getByPlaceholderText('Issue 标题'), { target: { value: 'B 草稿' } });
  await act(async () => pending.resolve(issue('A')));
  expect(screen.getByPlaceholderText('Issue 标题')).toHaveValue('B 草稿');
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.create).toHaveBeenCalledWith('/A', 'A 待提交', '');
});

it('缺 patch 明确显示未知原因，并可进入固定版本的本地完整比较', async () => {
  useGitGraphStore.setState({ selectedPr: pr('A'), selectedPrRepoRoot: '/A', selectedFile: 'paper.md', filesLoading: false, filesError: null,
    prDiff: { items: [{ oldPath: 'paper.md', newPath: 'paper.md', status: 'modified', hunks: [], patchStatus: 'unavailable' }], nextPage: null, headOid: 'b'.repeat(40), baseOid: 'a'.repeat(40), webUrl: 'https://github.com/o/A/pull/7/files', limited: false } });
  render(<PrFileDiffPanel />);
  expect(screen.getByRole('status')).toHaveTextContent('不能据此判断它是二进制文件');
  fireEvent.click(screen.getByRole('button', { name: '本地完整正文比较' }));
  await waitFor(() => expect(useGitGraphStore.getState().leftMode).toBe('compare'));
  expect(useGitGraphStore.getState().comparisonStart).toEqual({ comparison: { from: { name: 'main（共同祖先）', oid: 'c'.repeat(40) }, to: { name: 'topic', oid: 'b'.repeat(40) } }, path: 'paper.md' });
});

it('PR 页码控制可读下一页，局部更新不会把过期页混成完整列表', async () => {
  api.pulls.mockResolvedValueOnce({ items: [pr('first')], nextPage: 2 }).mockResolvedValueOnce({ items: [pr('second')], nextPage: null });
  render(<PullRequestPanel />);
  await screen.findByRole('button', { name: 'first 的 PR' });
  fireEvent.click(within(screen.getByRole('navigation', { name: 'GitHub 分页' })).getByRole('button', { name: '下一页' }));
  await screen.findByRole('button', { name: 'second 的 PR' });
  expect(screen.queryByRole('button', { name: 'first 的 PR' })).not.toBeInTheDocument();
});
