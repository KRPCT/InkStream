import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { useGitStore } from '../../stores/useGitStore';
import type { PullRequest } from '../../types/git';
import PrDetailPanel from './PrDetailPanel';

const api = vi.hoisted(() => ({ list: vi.fn(), reply: vi.fn() }));
vi.mock('../../ipc/git', async (original) => ({
  ...await original<typeof import('../../ipc/git')>(),
  ghPrReviews: vi.fn(async () => []), ghCommentList: vi.fn(async () => []),
  ghPrReviewComments: (...args: unknown[]) => api.list(...args),
  ghPrReply: (...args: unknown[]) => api.reply(...args),
}));
const pr: PullRequest = { number: 7, title: '论文修改', body: '', state: 'open', draft: false, url: 'https://github.com/o/r/pull/7', author: 'author', headRef: 'topic', baseRef: 'main' };
const root = { id: 10, inReplyToId: null, author: 'reviewer', body: '请补充证据', path: 'paper.md', line: 4, originalLine: 4, diffHunk: '@@ -1 +1 @@', url: 'https://github.com/o/r/pull/7#discussion_r10', createdAt: '2026-09-11T00:00:00Z' };
beforeEach(() => {
  useGitStore.setState({ repoRoot: '/repo' });
  useGitGraphStore.setState({ selectedPr: pr });
  api.list.mockReset().mockResolvedValue([root, { ...root, id: 11, inReplyToId: 10, author: 'author', body: '正在修改' }]);
  api.reply.mockReset().mockResolvedValue({ ...root, id: 12, inReplyToId: 10, body: '已补充' });
});

describe('reply within the selected PR review discussion', () => {
  it('shows a review thread and posts a reply to its root comment rather than the PR issue conversation', async () => {
    render(<PrDetailPanel />);
    const thread = await screen.findByRole('group', { name: 'paper.md 第 4 行讨论' });
    expect(within(thread).getByText('请补充证据')).toBeVisible();
    expect(within(thread).getByText('正在修改')).toBeVisible();
    fireEvent.change(within(thread).getByLabelText('回复此讨论'), { target: { value: '已补充' } });
    fireEvent.click(within(thread).getByRole('button', { name: '回复' }));
    await waitFor(() => expect(api.reply).toHaveBeenCalledWith('/repo', 7, 10, '已补充'));
    expect(await within(thread).findByText('已补充')).toBeVisible();
  });

  it('keeps reply text after an API error and offers a deliberate retry', async () => {
    api.reply.mockRejectedValue(new Error('GitHub API 错误（403）：权限不足'));
    render(<PrDetailPanel />);
    const thread = await screen.findByRole('group', { name: 'paper.md 第 4 行讨论' });
    const input = within(thread).getByLabelText('回复此讨论');
    fireEvent.change(input, { target: { value: '请保留这段回复' } });
    fireEvent.click(within(thread).getByRole('button', { name: '回复' }));
    expect(await within(thread).findByRole('alert')).toHaveTextContent('403');
    expect(input).toHaveValue('请保留这段回复');
    expect(within(thread).getByRole('button', { name: '回复' })).toBeEnabled();
  });

  it('does not display a completed old reply in a newly selected PR', async () => {
    let finish!: (value: typeof root) => void;
    api.reply.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<PrDetailPanel />);
    const thread = await screen.findByRole('group', { name: 'paper.md 第 4 行讨论' });
    fireEvent.change(within(thread).getByLabelText('回复此讨论'), { target: { value: '只属于旧 PR' } });
    fireEvent.click(within(thread).getByRole('button', { name: '回复' }));
    api.list.mockResolvedValue([]);
    act(() => useGitGraphStore.setState({ selectedPr: { ...pr, number: 8 } }));
    await act(async () => { finish({ ...root, id: 12, body: '只属于旧 PR' }); });
    expect(screen.queryByText('只属于旧 PR')).not.toBeInTheDocument();
    expect(screen.queryByText('请补充证据')).not.toBeInTheDocument();
  });
});
