import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backlinks = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock('../../ipc/indexService', () => ({
  queryBacklinkReferences: async (path: string) => (await backlinks(path)).map((sourcePath: string) => ({
    sourcePath, targetPath: '目标文档', from: 0, to: 8, contextFrom: 0, context: '[[目标文档]]', linkText: '[[目标文档]]',
  })),
  queryUnlinkedMentions: vi.fn().mockResolvedValue([]),
  indexRebuild: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../editor/fileOpenFlow', () => ({ openFileByPath: vi.fn(), openFileAndLocate: vi.fn().mockResolvedValue(true) }));

import { useEditorStore } from '../../stores/useEditorStore';
import { useIndexStore } from '../../stores/useIndexStore';
import BacklinksPanel from './BacklinksPanel';

describe('反链视图区分查询阶段并响应真实索引提交', () => {
  beforeEach(() => {
    backlinks.mockReset().mockResolvedValue([]);
    useEditorStore.setState({ activePath: '目标文档.md' });
    useIndexStore.setState({ scope: { root: '/a', sessionId: 'a' }, status: 'ready', revision: 1, error: null });
  });

  it('查询未完成时显示加载状态，不能先显示暂无反链', async () => {
    backlinks.mockReturnValue(new Promise(() => {}));
    render(<BacklinksPanel />);
    expect(screen.getByRole('status')).toHaveTextContent('正在');
    expect(screen.queryByText('暂无反向链接')).not.toBeInTheDocument();
  });

  it('查询失败显示可重试错误，不能当成合法零结果', async () => {
    backlinks.mockRejectedValue(new Error('索引查询失败：fixture'));
    render(<BacklinksPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('索引查询失败');
    expect(screen.queryByText('暂无反向链接')).not.toBeInTheDocument();
  });

  it('当前文档没有切换，其他文档索引提交后也刷新反链', async () => {
    backlinks.mockResolvedValue(['旧引用.md']);
    render(<BacklinksPanel />);
    expect(await screen.findByText('旧引用.md')).toBeInTheDocument();
    backlinks.mockResolvedValue(['新引用.md']);
    act(() => useIndexStore.setState({ revision: 2 }));
    expect(await screen.findByText('新引用.md')).toBeInTheDocument();
    expect(screen.queryByText('旧引用.md')).not.toBeInTheDocument();
  });

  it('同名文档换工作区后，旧查询结果不能覆盖新工作区', async () => {
    let oldResult!: (paths: string[]) => void;
    backlinks.mockReturnValueOnce(new Promise<string[]>((resolve) => { oldResult = resolve; }));
    backlinks.mockResolvedValueOnce(['B的引用.md']);
    render(<BacklinksPanel />);
    act(() => useIndexStore.setState({ scope: { root: '/b', sessionId: 'b' } }));
    expect(await screen.findByText('B的引用.md')).toBeInTheDocument();
    await act(async () => oldResult(['A的旧引用.md']));
    expect(screen.queryByText('A的旧引用.md')).not.toBeInTheDocument();
    expect(screen.getByText('B的引用.md')).toBeInTheDocument();
  });

  it('同工作区切文档时也立即隐藏上一文档结果', async () => {
    backlinks.mockResolvedValueOnce(['前文档引用.md']);
    render(<BacklinksPanel />);
    expect(await screen.findByText('前文档引用.md')).toBeInTheDocument();
    backlinks.mockReturnValue(new Promise(() => {}));
    act(() => useEditorStore.setState({ activePath: '另一文档.md' }));
    expect(screen.getByRole('status')).toHaveTextContent('正在');
    expect(screen.queryByText('前文档引用.md')).not.toBeInTheDocument();
  });

  it('查询期间发生索引提交，迟到的旧快照不能替换新提交结果', async () => {
    let oldResult!: (paths: string[]) => void;
    backlinks.mockReturnValueOnce(new Promise<string[]>((resolve) => { oldResult = resolve; }));
    backlinks.mockResolvedValueOnce(['提交后引用.md']);
    render(<BacklinksPanel />);
    act(() => useIndexStore.setState({ revision: 2 }));
    expect(await screen.findByText('提交后引用.md')).toBeInTheDocument();
    await act(async () => oldResult(['提交前引用.md']));
    expect(screen.queryByText('提交前引用.md')).not.toBeInTheDocument();
    expect(screen.getByText('提交后引用.md')).toBeInTheDocument();
  });
});
