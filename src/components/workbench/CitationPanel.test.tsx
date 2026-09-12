import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '../../ipc/invoke';
import { zoteroSetCredentials } from '../../ipc/zotero';
import { useCitationStore } from '../../stores/useCitationStore';
import { useEditorStore } from '../../stores/useEditorStore';
import type { ZoteroItem } from '../../types/zotero';
import CitationPanel from './CitationPanel';

vi.mock('../../ipc/invoke', () => ({ invoke: vi.fn() }));
const entry = (citekey: string): ZoteroItem => ({ citekey, title: citekey, authors: 'Author', year: '2024' });

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({ documentBudget: { mode: 'full', large: false, preference: 'auto' } });
  useCitationStore.setState({ citations: [{ key: 'known', count: 2 }, { key: 'missing', count: 1 }], validKeys: [], resolved: false });
});
afterEach(cleanup);

describe('CitationPanel resolves the current library without treating failures as missing references', () => {
  it('uses the real offline fallback when BBT is unavailable and reports that source', async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'zotero_items') throw new Error('Zotero 未运行');
      if (command === 'zotero_cache_items') return [entry('known')];
      return null;
    });
    render(<CitationPanel />);
    expect(await screen.findByText('离线缓存')).toBeVisible();
    expect(screen.getByText('1 未解析')).toBeVisible();
    expect(screen.getByText('[@known]').closest('li')).toHaveAttribute('title', 'known');
    expect(useCitationStore.getState().validKeys).toEqual(['known']);
  });

  it('clears old resolution immediately on account change and rejects a late old-account response', async () => {
    let resolveOld!: (items: ZoteroItem[]) => void;
    let resolveNew!: (items: ZoteroItem[]) => void;
    let calls = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'zotero_items') {
        calls += 1;
        if (calls === 1) return [entry('known')];
        return new Promise<ZoteroItem[]>((resolve) => { if (calls === 2) resolveOld = resolve; else resolveNew = resolve; });
      }
      return null;
    });
    render(<CitationPanel />);
    await waitFor(() => expect(useCitationStore.getState().validKeys).toEqual(['known']));
    fireEvent.click(screen.getByTitle('重新解析引用'));
    await act(async () => { await zoteroSetCredentials('test-key', 'new-account'); });
    expect(useCitationStore.getState().resolved).toBe(false);
    expect(screen.queryByText('1 未解析')).toBeNull();
    await act(async () => { resolveNew([entry('missing')]); });
    await waitFor(() => expect(useCitationStore.getState().validKeys).toEqual(['missing']));
    await act(async () => { resolveOld([entry('known')]); });
    expect(useCitationStore.getState().validKeys).toEqual(['missing']);
    expect(screen.getByText('[@known]').closest('li')).toHaveAttribute('title', '未在 Zotero 库中找到此 citekey');
  });

  it('a lookup failure remains unclassified and a manual retry can resolve it', async () => {
    let failing = true;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'zotero_items') {
        if (failing) throw new Error('BBT unavailable');
        return [entry('known'), entry('missing')];
      }
      if (command === 'zotero_cache_items') return [];
      return null;
    });
    render(<CitationPanel />);
    expect(await screen.findByText(/尚未判定引用是否存在/)).toBeVisible();
    expect(useCitationStore.getState().resolved).toBe(false);
    expect(screen.queryByText(/\d 未解析/)).toBeNull();
    failing = false;
    fireEvent.click(screen.getByTitle('重新解析引用'));
    await waitFor(() => expect(useCitationStore.getState().resolved).toBe(true));
    expect(screen.queryByText(/尚未判定/)).toBeNull();
    expect(useCitationStore.getState().validKeys).toEqual(['known', 'missing']);
  });

  it('an unmounted panel cannot publish its pending result into a later panel', async () => {
    let resolveOld!: (items: ZoteroItem[]) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const old = render(<CitationPanel />);
    old.unmount();
    vi.mocked(invoke).mockResolvedValue([entry('missing')]);
    render(<CitationPanel />);
    await waitFor(() => expect(useCitationStore.getState().validKeys).toEqual(['missing']));
    await act(async () => { resolveOld([entry('known')]); });
    expect(useCitationStore.getState().validKeys).toEqual(['missing']);
  });
});
