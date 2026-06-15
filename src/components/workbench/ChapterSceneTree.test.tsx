import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChapterNode } from '../../types/creative';

const openFileByPath = vi.fn();
vi.mock('../../editor/fileOpenFlow', () => ({ openFileByPath: (p: string) => openFileByPath(p) }));

const buildChapterTree = vi.fn<() => Promise<ChapterNode[]>>();
// 保留真实 STATUS_LABEL/STATUS_TOKEN（组件消费），仅替身 buildChapterTree（避免真实 IPC）。
vi.mock('../../editor/chapterTree', async (orig) => ({
  ...(await orig<typeof import('../../editor/chapterTree')>()),
  buildChapterTree: () => buildChapterTree(),
}));

const { default: ChapterSceneTree } = await import('./ChapterSceneTree');
const { useVaultStore } = await import('../../stores/useVaultStore');
const { useEditorStore } = await import('../../stores/useEditorStore');

const TREE: ChapterNode[] = [
  {
    name: '第一章',
    path: '第一章',
    scenes: [
      { path: '第一章/s1.md', name: '雨夜', status: 'final', words: 1200 },
      { path: '第一章/s2.md', name: '清晨', status: 'draft', words: 0 },
    ],
  },
];

beforeEach(() => {
  openFileByPath.mockClear();
  buildChapterTree.mockReset().mockResolvedValue(TREE);
  useVaultStore.setState({ vault: { root: '/v', repoRoot: null, name: 'v' }, tree: [] });
  useEditorStore.setState({ activePath: null });
});

describe('ChapterSceneTree（CREA-01）', () => {
  it('渲染章/场景 + 字数；点击场景以相对路径打开', async () => {
    render(<ChapterSceneTree />);
    expect(await screen.findByText('雨夜')).toBeInTheDocument();
    expect(screen.getByText('第一章')).toBeInTheDocument();
    expect(screen.getByText('1200')).toBeInTheDocument();
    fireEvent.click(screen.getByText('雨夜'));
    expect(openFileByPath).toHaveBeenCalledWith('第一章/s1.md');
  });
});
