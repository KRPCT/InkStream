import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 反链面板回归门（Phase 4 W4 / LINK-05）。indexService 查询经替身，断言渲染 + 点击跳转。 */

const queryBacklinks = vi.fn<(p: string) => Promise<string[]>>(() => Promise.resolve([]));
const queryUnlinkedMentions = vi.fn<(p: string) => Promise<string[]>>(() => Promise.resolve([]));
vi.mock('../../ipc/indexService', () => ({
  queryBacklinkReferences: async (p: string) => (await queryBacklinks(p)).map((sourcePath) => ({
    sourcePath, targetPath: '当前', from: 0, to: 6, contextFrom: 0, context: '[[当前]]', linkText: '[[当前]]',
  })),
  queryUnlinkedMentions: (p: string) => queryUnlinkedMentions(p),
  indexRebuild: vi.fn().mockResolvedValue(null),
}));
const openFileByPath = vi.fn<(p: string) => Promise<void>>(() => Promise.resolve());
const openFileAndLocate = vi.fn().mockResolvedValue(true);
vi.mock('../../editor/fileOpenFlow', () => ({
  openFileByPath: (p: string) => openFileByPath(p),
  openFileAndLocate: (...args: unknown[]) => openFileAndLocate(...args),
}));

const { default: BacklinksPanel } = await import('./BacklinksPanel');
const { useEditorStore } = await import('../../stores/useEditorStore');
const { useIndexStore } = await import('../../stores/useIndexStore');

beforeEach(() => {
  queryBacklinks.mockReset().mockResolvedValue([]);
  queryUnlinkedMentions.mockReset().mockResolvedValue([]);
  openFileByPath.mockClear();
  openFileAndLocate.mockClear();
  useEditorStore.setState({ activePath: 'notes/当前.md' });
  useIndexStore.setState({ scope: { root: '/fixture', sessionId: 'fixture' }, status: 'ready', revision: 1, error: null });
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

  it('点击反链行 → 来源相对路径与当前正文定位回调', async () => {
    queryBacklinks.mockResolvedValue(['a/引用甲.md']);
    render(<BacklinksPanel />);
    fireEvent.click(await screen.findByText('引用甲.md'));
    expect(openFileAndLocate).toHaveBeenCalledWith('a/引用甲.md', expect.any(Function));
  });

  it('无活动文件 → 空态且不查询', async () => {
    useEditorStore.setState({ activePath: null });
    render(<BacklinksPanel />);
    expect(await screen.findByText('暂无反向链接')).toBeInTheDocument();
    expect(queryBacklinks).not.toHaveBeenCalled();
  });
});
