import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CommentThread from './CommentThread';

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock('../../ipc/git', () => ({ ghCommentList: (...args: unknown[]) => api.list(...args), ghCommentCreate: (...args: unknown[]) => api.create(...args) }));
beforeEach(() => { api.list.mockReset().mockResolvedValue([]); api.create.mockReset(); });

it('a late post in PR A cannot clear the new PR B comment draft', async () => {
  let finish!: () => void;
  api.create.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const rendered = render(<CommentThread repoRoot="/repo" number={1} />);
  fireEvent.change(screen.getByPlaceholderText('写下评论…'), { target: { value: 'A comment' } });
  fireEvent.click(screen.getByRole('button', { name: '评论' }));
  rendered.rerender(<CommentThread repoRoot="/repo" number={2} />);
  fireEvent.change(screen.getByPlaceholderText('写下评论…'), { target: { value: 'B draft' } });
  await act(async () => { finish(); });
  expect(screen.getByPlaceholderText('写下评论…')).toHaveValue('B draft');
  expect(api.create).toHaveBeenCalledWith('/repo', 1, 'A comment');
});

it('a newly selected PR immediately stops showing comments loaded for the previous one', async () => {
  api.list.mockResolvedValueOnce([{ id: 1, author: 'A', body: 'Only A' }]).mockImplementation(() => new Promise(() => {}));
  const rendered = render(<CommentThread repoRoot="/repo" number={1} />);
  await screen.findByText('Only A');
  rendered.rerender(<CommentThread repoRoot="/repo" number={2} />);
  expect(screen.queryByText('Only A')).not.toBeInTheDocument();
});
