import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 反链面板回归门（Phase 4 W4 / LINK-05）。indexService 查询经替身，断言渲染 + 点击跳转。 */

const queryBacklinks = vi.fn<(p: string) => Promise<string[]>>(() => Promise.resolve([]));
const queryUnlinkedMentions = vi.fn<(p: string) => Promise<string[]>>(() => Promise.resolve([]));
vi.mock('../../ipc/indexService', () => ({
  queryBacklinks: (p: string) => queryBacklinks(p),
  queryUnlinkedMentions: (p: string) => queryUnlinkedMentions(p),
}));
const openFileByPath = vi.fn<(p: string) => Promise<void>>(() => Promise.resolve());
vi.mock('../../editor/fileOpenFlow', () => ({ openFileByPath: (p: string) => openFileByPath(p) }));

const { default: BacklinksPanel } = await import('./BacklinksPanel');
const { useEditorStore } = await import('../../stores/useEditorStore');

beforeEach(() => {
  queryBacklinks.mockReset().mockResolvedValue([]);
  queryUnlinkedMentions.mockReset().mockResolvedValue([]);
  openFileByPath.mockClear();
  useEditorStore.setState({ activePath: 'notes/当前.md' });
});

describe('BacklinksPanel', () => {
  it('渲染反向链接列表（文件名 + 计数）', async () => {
    queryBacklinks.mockResolvedValue(['a/引用甲.md', 'b/引用乙.md']);
    render(<BacklinksPanel />);
    expect(await screen.findByText('反向链接（2）')).toBeInTheDocument();
    expect(screen.getByText('引用甲.md')).toBeInTheDocument();
    expect(screen.getByText('引用乙.md')).toBeInTheDocument();
  });

  it('渲染未链接提及分组', async () => {
    queryUnlinkedMentions.mockResolvedValue(['c/提及.md']);
    render(<BacklinksPanel />);
    expect(await screen.findByText('未链接提及（1）')).toBeInTheDocument();
    expect(screen.getByText('提及.md')).toBeInTheDocument();
  });

  it('无反链无提及 → 空态文案', async () => {
    render(<BacklinksPanel />);
    expect(await screen.findByText('暂无反向链接')).toBeInTheDocument();
  });

  it('点击反链行 → openFileByPath(相对路径)', async () => {
    queryBacklinks.mockResolvedValue(['a/引用甲.md']);
    render(<BacklinksPanel />);
    fireEvent.click(await screen.findByText('引用甲.md'));
    expect(openFileByPath).toHaveBeenCalledWith('a/引用甲.md');
  });

  it('无活动文件 → 空态且不查询', async () => {
    useEditorStore.setState({ activePath: null });
    render(<BacklinksPanel />);
    expect(await screen.findByText('暂无反向链接')).toBeInTheDocument();
    expect(queryBacklinks).not.toHaveBeenCalled();
  });
});
