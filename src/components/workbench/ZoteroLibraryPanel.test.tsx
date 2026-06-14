import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZoteroItem } from '../../types/zotero';

/** Sidebar Zotero 文献库回归门（Phase 8 ACAD-01）。zoteroItems 经替身，断言渲染 / 过滤 / 点击插入 / 错误态。 */

const zoteroItems = vi.fn<() => Promise<ZoteroItem[]>>(() => Promise.resolve([]));
vi.mock('../../ipc/zotero', () => ({ zoteroItems: () => zoteroItems() }));
const insertCitekey = vi.fn<(k: string) => void>();
vi.mock('../../editor/academicActions', () => ({ insertCitekey: (k: string) => insertCitekey(k) }));

const { default: ZoteroLibraryPanel } = await import('./ZoteroLibraryPanel');

const ITEMS: ZoteroItem[] = [
  { citekey: 'lecunDeepLearning2015', title: 'Deep learning', authors: 'LeCun 等', year: '2015' },
  { citekey: 'vaswaniAttention2017', title: 'Attention Is All You Need', authors: 'Vaswani 等', year: '2017' },
];

beforeEach(() => {
  zoteroItems.mockReset().mockResolvedValue(ITEMS);
  insertCitekey.mockClear();
});

describe('ZoteroLibraryPanel', () => {
  it('渲染库条目（标题 + 作者·年）与计数', async () => {
    render(<ZoteroLibraryPanel />);
    expect(await screen.findByText('Deep learning')).toBeInTheDocument();
    expect(screen.getByText('LeCun 等 · 2015')).toBeInTheDocument();
    expect(screen.getByText('Attention Is All You Need')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('过滤框按标题/作者/citekey 缩减列表', async () => {
    render(<ZoteroLibraryPanel />);
    await screen.findByText('Deep learning');
    fireEvent.change(screen.getByPlaceholderText('过滤文献…'), { target: { value: 'vaswani' } });
    expect(screen.queryByText('Deep learning')).not.toBeInTheDocument();
    expect(screen.getByText('Attention Is All You Need')).toBeInTheDocument();
  });

  it('点击条目 → insertCitekey(citekey)', async () => {
    render(<ZoteroLibraryPanel />);
    fireEvent.click(await screen.findByText('Deep learning'));
    expect(insertCitekey).toHaveBeenCalledWith('lecunDeepLearning2015');
  });

  it('zoteroItems 抛错 → 未连接 + 错误文案', async () => {
    zoteroItems.mockRejectedValue('Zotero 未运行');
    render(<ZoteroLibraryPanel />);
    expect(await screen.findByText('未连接')).toBeInTheDocument();
    expect(screen.getByText('Zotero 未运行')).toBeInTheDocument();
  });

  it('库为空 → 空态文案', async () => {
    zoteroItems.mockResolvedValue([]);
    render(<ZoteroLibraryPanel />);
    expect(await screen.findByText('库为空')).toBeInTheDocument();
  });
});
