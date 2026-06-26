import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const openFileAtOffset = vi.hoisted(() => vi.fn());
vi.mock('../../editor/fileOpenFlow', () => ({ openFileAtOffset }));

const replaceAllInProject = vi.hoisted(() => vi.fn());
vi.mock('../../editor/multibuffer/replaceAll', () => ({ replaceAllInProject }));

const confirmDestructive = vi.hoisted(() => vi.fn());
vi.mock('../../stores/useConfirmStore', () => ({ confirmDestructive }));

const showToast = vi.hoisted(() => vi.fn());
vi.mock('../../stores/useToastStore', () => ({ showToast }));

import type { FileMatches } from '../../editor/multibuffer/projectSearch';
import { useProjectSearchStore } from '../../stores/useProjectSearchStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import ProjectSearchView from './ProjectSearchView';

const RESULTS: FileMatches[] = [
  {
    path: 'notes/a.md',
    matchCount: 1,
    excerpts: [{ sourceFrom: 0, sourceTo: 5, text: '前foo后', firstLine: 1, matches: [{ from: 1, to: 4 }] }],
  },
  {
    path: 'b.md',
    matchCount: 1,
    excerpts: [{ sourceFrom: 0, sourceTo: 5, text: 'xfooy', firstLine: 3, matches: [{ from: 1, to: 4 }] }],
  },
];

const run = vi.fn();

function setStore(partial: Partial<ReturnType<typeof useProjectSearchStore.getState>>): void {
  act(() => useProjectSearchStore.setState({ run, ...partial }));
}

beforeEach(() => {
  openFileAtOffset.mockClear();
  replaceAllInProject.mockReset();
  confirmDestructive.mockReset();
  showToast.mockClear();
  run.mockClear();
  act(() => useVaultStore.setState({ vault: { root: 'D:/v', repoRoot: null, name: 'v' }, files: [] }));
  act(() => useWorkbenchStore.setState({ centralView: 'multibuffer' }));
  act(() =>
    useProjectSearchStore.setState({ query: '', results: [], totalMatches: 0, truncated: false, status: 'idle', run }),
  );
});

afterEach(() => {
  act(() => useVaultStore.setState(useVaultStore.getInitialState(), true));
});

describe('ProjectSearchView', () => {
  it('渲染文件分组、命中片段包 <mark>、合计计数', () => {
    setStore({ query: 'foo', results: RESULTS, totalMatches: 2, status: 'done' });
    render(<ProjectSearchView />);
    expect(screen.getByText('notes/a.md')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
    const marks = screen.getAllByText('foo');
    expect(marks[0].tagName).toBe('MARK');
    expect(screen.getByText(/2 处 · 2 文件/)).toBeInTheDocument();
  });

  it('点击命中 → openFileAtOffset(路径, 命中偏移) 并回到编辑器', () => {
    setStore({ query: 'foo', results: RESULTS, totalMatches: 2, status: 'done' });
    render(<ProjectSearchView />);
    fireEvent.click(screen.getAllByText('foo')[0]);
    expect(openFileAtOffset).toHaveBeenCalledWith('notes/a.md', 1);
    expect(useWorkbenchStore.getState().centralView).toBe('editor');
  });

  it('关闭按钮回到编辑器', () => {
    render(<ProjectSearchView />);
    fireEvent.click(screen.getByLabelText('关闭全库搜索'));
    expect(useWorkbenchStore.getState().centralView).toBe('editor');
  });

  it('输入防抖触发 run', () => {
    vi.useFakeTimers();
    try {
      render(<ProjectSearchView />);
      fireEvent.change(screen.getByLabelText('全库搜索'), { target: { value: '研究方法' } });
      act(() => vi.advanceTimersByTime(180));
      expect(run).toHaveBeenCalledWith('研究方法');
    } finally {
      vi.useRealTimers();
    }
  });

  it('无 vault：提示先打开工作区', () => {
    act(() => useVaultStore.setState({ vault: null, files: [] }));
    render(<ProjectSearchView />);
    expect(screen.getByText(/先打开一个文件夹/)).toBeInTheDocument();
  });

  it('短词：提示至少 3 字', () => {
    setStore({ query: 'ab', status: 'done', results: [] });
    render(<ProjectSearchView />);
    expect(screen.getByText(/至少输入 3 个字符/)).toBeInTheDocument();
  });

  it('无结果：提示未找到', () => {
    setStore({ query: 'zzz', status: 'done', results: [] });
    render(<ProjectSearchView />);
    expect(screen.getByText(/未找到「zzz」/)).toBeInTheDocument();
  });

  it('无结果时「全部替换」禁用', () => {
    setStore({ query: 'zzz', status: 'done', results: [] });
    render(<ProjectSearchView />);
    expect(screen.getByText('全部替换')).toBeDisabled();
  });

  it('确认后调用 replaceAllInProject(query, replacement) 并刷新（干净成功不打扰）', async () => {
    confirmDestructive.mockResolvedValue(true);
    replaceAllInProject.mockResolvedValue({ files: 1, replaced: 2, skipped: [], failed: [] });
    setStore({ query: 'foo', results: RESULTS, totalMatches: 2, status: 'done' });
    render(<ProjectSearchView />);
    fireEvent.change(screen.getByLabelText('替换为'), { target: { value: 'bar' } });
    fireEvent.click(screen.getByText('全部替换'));
    await waitFor(() => expect(replaceAllInProject).toHaveBeenCalledWith('foo', 'bar'));
    await waitFor(() => expect(run).toHaveBeenCalledWith('foo'));
    expect(showToast).not.toHaveBeenCalled(); // 干净成功无 toast
  });

  it('取消确认：不替换', async () => {
    confirmDestructive.mockResolvedValue(false);
    setStore({ query: 'foo', results: RESULTS, totalMatches: 2, status: 'done' });
    render(<ProjectSearchView />);
    fireEvent.click(screen.getByText('全部替换'));
    await act(async () => {});
    expect(replaceAllInProject).not.toHaveBeenCalled();
  });

  it('结果被截断：确认框如实告知只替换已列出文件', async () => {
    confirmDestructive.mockResolvedValue(false);
    setStore({ query: 'foo', results: RESULTS, totalMatches: 2, truncated: true, status: 'done' });
    render(<ProjectSearchView />);
    fireEvent.click(screen.getByText('全部替换'));
    await waitFor(() =>
      expect(confirmDestructive).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringContaining('截断') }),
      ),
    );
  });

  it('有跳过/失败：warning 提示', async () => {
    confirmDestructive.mockResolvedValue(true);
    replaceAllInProject.mockResolvedValue({ files: 1, replaced: 1, skipped: ['c.md'], failed: ['d.md'] });
    setStore({ query: 'foo', results: RESULTS, totalMatches: 2, status: 'done' });
    render(<ProjectSearchView />);
    fireEvent.click(screen.getByText('全部替换'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('warning', expect.stringContaining('失败')));
  });
});
