import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GitCompareFile, GitComparePage, GitCompareSide } from '../../types/gitCompare';

const { files, text } = vi.hoisted(() => ({ files: vi.fn(), text: vi.fn() }));
vi.mock('../../ipc/gitCompare', () => ({ gitCompareFiles: files, gitCompareText: text }));
vi.mock('../../editor/branchComparisonClient', async () => {
  const { compareFullText } = await import('../../diff/compareText');
  return { compareBranchText: async (old: string, next: string) => compareFullText(old, next) };
});
import { useGitStore } from '../../stores/useGitStore';
import { useVaultStore } from '../../stores/useVaultStore';
import BranchCompareView from './BranchCompareView';

const oldOid = 'a'.repeat(40); const newOid = 'b'.repeat(40);
function side(path: string, commitOid: string): GitCompareSide { return { path, commitOid, blobOid: commitOid, byteLength: 100, readable: true }; }
function file(path = '章节.md'): GitCompareFile { return { status: 'modified', old: side(path, oldOid), new: side(path, newOid) }; }
function page(items = [file()]): GitComparePage { return { fromOid: oldOid, toOid: newOid, total: items.length, next: null, files: items }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

beforeEach(() => {
  files.mockReset().mockResolvedValue(page());
  text.mockReset().mockImplementation(async (_root: string, target: GitCompareSide | null) => !target ? '' : target.commitOid === oldOid ? '未改开头。\n\n旧句。\n\n完整末尾。' : '未改开头。\n\n新句。\n\n完整末尾。');
  useVaultStore.setState({ vault: { root: '/repo', repoRoot: '/repo', name: 'fixture' } });
  useGitStore.setState({ repoRoot: '/repo', branches: [
    { name: 'main', target: oldOid, isHead: false, isRemote: false, ahead: 0, behind: 0, upstream: null },
    { name: 'draft', target: newOid, isHead: true, isRemote: false, ahead: 0, behind: 0, upstream: null },
  ] });
});
afterEach(cleanup);

it('选择两分支展示完整正文，反向比较继续使用已固定 OID', async () => {
  render(<BranchCompareView />);
  fireEvent.click(screen.getByRole('button', { name: '比较完整正文' }));
  await screen.findByLabelText('目标完整正文');
  expect(screen.getByLabelText('目标完整正文').textContent).toContain('完整末尾。');
  expect(screen.getByLabelText('基线完整正文').textContent).toContain('未改开头。');
  expect(files).toHaveBeenLastCalledWith('/repo', oldOid, newOid, 0, null);
  act(() => useGitStore.setState({ branches: useGitStore.getState().branches.map((branch) => ({ ...branch, target: 'c'.repeat(40) })) }));
  fireEvent.click(screen.getByRole('button', { name: '反向比较' }));
  await waitFor(() => expect(files).toHaveBeenLastCalledWith('/repo', newOid, oldOid, 0, null));
});

it('选择改变会取消等待状态，旧文件清单迟到也不能重新出现', async () => {
  const pending = deferred<GitComparePage>(); files.mockReturnValueOnce(pending.promise);
  render(<BranchCompareView />);
  fireEvent.click(screen.getByRole('button', { name: '比较完整正文' }));
  await screen.findByText('正在读取比较文件清单…');
  fireEvent.change(screen.getByLabelText('目标分支'), { target: { value: 'local:main' } });
  await act(async () => pending.resolve(page()));
  expect(screen.queryByText('正在读取比较文件清单…')).not.toBeInTheDocument();
  expect(screen.queryByText('修改 · 章节.md')).not.toBeInTheDocument();
  expect(text).not.toHaveBeenCalled();
});

it('切换比较文件中止正文读取，迟到正文不会覆盖新选中的文件', async () => {
  files.mockResolvedValue(page([file('one.md'), file('two.md')]));
  const pending = deferred<string>();
  text.mockImplementation(async (_root: string, target: GitCompareSide) => target.path === 'one.md' ? pending.promise : '第二份完整正文。');
  render(<BranchCompareView />);
  fireEvent.click(screen.getByRole('button', { name: '比较完整正文' }));
  await screen.findByRole('button', { name: '修改 · two.md' });
  await waitFor(() => expect(text).toHaveBeenCalled());
  const firstSignal = text.mock.calls[0][2] as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: '修改 · two.md' }));
  await screen.findByLabelText('目标完整正文');
  expect(firstSignal.aborted).toBe(true);
  await act(async () => pending.resolve('过期正文不能出现'));
  expect(screen.getByLabelText('目标完整正文').textContent).toBe('第二份完整正文。');
  expect(screen.queryByText('过期正文不能出现')).not.toBeInTheDocument();
});

it('无差异、读取错误都有明确结果，退出会取消本次正文读取', async () => {
  files.mockResolvedValueOnce(page([]));
  const result = render(<BranchCompareView />);
  fireEvent.click(screen.getByRole('button', { name: '比较完整正文' }));
  await screen.findByText('两个分支没有文件差异。');
  text.mockRejectedValueOnce(new Error('不是 UTF-8 文本'));
  fireEvent.click(screen.getByRole('button', { name: '比较完整正文' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('不是 UTF-8 文本');
  const controller = text.mock.calls[0][2] as AbortSignal;
  result.unmount();
  expect(controller.aborted).toBe(true);
});
