import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zoteroSetCredentials } from '../../ipc/zotero';
import type { ZoteroItem } from '../../types/zotero';
import ZoteroLibraryPanel from './ZoteroLibraryPanel';

const { request } = vi.hoisted(() => ({
  request: vi.fn<(name: string, args?: unknown) => Promise<unknown>>(),
}));
vi.mock('../../ipc/invoke', () => ({ invoke: request }));
vi.mock('../../editor/academicActions', () => ({ insertCitekey: vi.fn() }));

const ACCOUNT_A: ZoteroItem[] = [{ citekey: 'a', title: '甲账户文献', authors: 'A', year: '2025' }];
const ACCOUNT_B: ZoteroItem[] = [{ citekey: 'b', title: '乙账户文献', authors: 'B', year: '2026' }];
let account: 'A' | 'B';
let initialCache: Promise<ZoteroItem[]>;

beforeEach(() => {
  account = 'A';
  initialCache = Promise.resolve(ACCOUNT_A);
  request.mockReset().mockImplementation(async (name) => {
    if (name === 'zotero_items') throw new Error('本机 Zotero 未运行');
    if (name === 'zotero_cache_items') return account === 'A' ? initialCache : ACCOUNT_B;
    if (name === 'zotero_set_credentials') { account = 'B'; return null; }
    throw new Error(`Unexpected fixture command: ${name}`);
  });
});
afterEach(cleanup);

describe('Zotero 账户切换后的可见文献', () => {
  it('保存另一账户后重新加载该账户缓存并移除旧列表', async () => {
    render(<ZoteroLibraryPanel />);
    expect(await screen.findByText('甲账户文献')).toBeInTheDocument();
    await act(async () => { await zoteroSetCredentials('fixture-key', '202'); });
    expect(await screen.findByText('乙账户文献')).toBeInTheDocument();
    expect(screen.queryByText('甲账户文献')).not.toBeInTheDocument();
  });

  it('迟到的旧账户读取结果不得覆盖当前账户', async () => {
    let releaseOld!: (items: ZoteroItem[]) => void;
    initialCache = new Promise((resolve) => { releaseOld = resolve; });
    render(<ZoteroLibraryPanel />);
    await waitFor(() => expect(request).toHaveBeenCalledWith('zotero_cache_items', undefined));
    await act(async () => { await zoteroSetCredentials('fixture-key', '202'); });
    await act(async () => { releaseOld(ACCOUNT_A); });
    expect(await screen.findByText('乙账户文献')).toBeInTheDocument();
    expect(screen.queryByText('甲账户文献')).not.toBeInTheDocument();
  });
});
