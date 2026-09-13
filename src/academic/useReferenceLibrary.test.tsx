import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CslItem, ZoteroItem } from '../types/zotero';

const api = vi.hoisted(() => ({ revision: 0, listeners: new Set<() => void>(), items: vi.fn(), detail: vi.fn() }));
vi.mock('../ipc/zotero', () => ({
  currentZoteroLibraryRevision: () => api.revision,
  onZoteroLibraryChanged: (listener: () => void) => { api.listeners.add(listener); return () => api.listeners.delete(listener); },
  zoteroItemsResilient: api.items, zoteroCslResilient: api.detail,
}));
import { useReferenceLibrary } from './useReferenceLibrary';
const a: ZoteroItem = { citekey: 'A', title: '甲库文献', authors: '甲', year: '2025' };
const b: ZoteroItem = { citekey: 'B', title: '乙库文献', authors: '乙', year: '2026' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { api.revision = 0; api.listeners.clear(); api.items.mockReset().mockResolvedValue({ items: [a], offline: false }); api.detail.mockReset().mockResolvedValue([]); });

describe('文献浏览会话', () => {
  it('WB-04 切换库立即清空旧选择，迟到详情不能进入新库或成为插入目标', async () => {
    const pending = deferred<CslItem[]>(); api.detail.mockReturnValue(pending.promise);
    const { result } = renderHook(useReferenceLibrary);
    await waitFor(() => expect(result.current.items).toEqual([a]));
    act(() => { void result.current.select(a); });
    expect(result.current.selectedKey()).toBe('A');
    api.items.mockResolvedValue({ items: [b], offline: true });
    await act(async () => { api.revision++; api.listeners.forEach((listener) => listener()); });
    expect(result.current.selected).toBeNull(); expect(result.current.selectedKey()).toBeNull();
    await act(async () => pending.resolve([{ id: 'A', DOI: 'old-library' }]));
    expect(result.current.detail).toBeNull(); expect(result.current.items).toEqual([b]); expect(result.current.offline).toBe(true);
  });
  it('WB-04 迟到列表不能覆盖当前库，卸载释放订阅', async () => {
    const pending = deferred<{ items: ZoteroItem[]; offline: boolean }>(); api.items.mockReturnValueOnce(pending.promise);
    const { result, unmount } = renderHook(useReferenceLibrary);
    api.items.mockResolvedValue({ items: [b], offline: false });
    await act(async () => { api.revision++; api.listeners.forEach((listener) => listener()); });
    await act(async () => pending.resolve({ items: [a], offline: false }));
    expect(result.current.items).toEqual([b]);
    unmount(); expect(api.listeners.size).toBe(0);
  });
  it('快速改选时详情始终属于最后选中的文献', async () => {
    api.items.mockResolvedValue({ items: [a, b], offline: false });
    const pending = deferred<CslItem[]>(); api.detail.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([{ id: 'B', DOI: 'new' }]);
    const { result } = renderHook(useReferenceLibrary);
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => { void result.current.select(a); });
    await act(async () => result.current.select(b));
    await act(async () => pending.resolve([{ id: 'A', DOI: 'old' }]));
    expect(result.current.selectedKey()).toBe('B'); expect(result.current.detail?.DOI).toBe('new');
  });
});
