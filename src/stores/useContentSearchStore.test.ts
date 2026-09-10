import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ipc/indexService', () => ({ queryContent: vi.fn() }));
import { queryContent, type ContentHit } from '../ipc/indexService';
import { useContentSearchStore } from './useContentSearchStore';
import { useVaultStore } from './useVaultStore';

const qc = vi.mocked(queryContent);

/** 手动可控的 Promise（用于制造查询乱序到达 / 在途未归）。 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  qc.mockReset();
  useContentSearchStore.setState({ term: '', hits: [], loading: false, error: null });
});

describe('useContentSearchStore', () => {
  it('查询错误成为明确状态并结束loading，不抛出未处理拒绝', async () => {
    qc.mockRejectedValue(new Error('索引暂不可用'));
    await expect(useContentSearchStore.getState().run('研究方法')).resolves.toBeUndefined();
    expect(useContentSearchStore.getState()).toMatchObject({ hits: [], loading: false, error: '索引暂不可用' });
  });

  it('查询在途换库后不能接纳旧库结果，即使没有发起下一次查询', async () => {
    useVaultStore.setState({ vault: { root: '/a', name: 'a', repoRoot: null } });
    const pending = deferred<ContentHit[]>();
    qc.mockReturnValue(pending.promise);
    const request = useContentSearchStore.getState().run('研究方法');
    useVaultStore.setState({ vault: { root: '/b', name: 'b', repoRoot: null } });
    pending.resolve([{ path: 'from-a.md', snippet: '旧库命中' }]);
    await request;
    expect(useContentSearchStore.getState()).toMatchObject({ hits: [], loading: false });
  });

  it('run 落地 hits 并复位 loading', async () => {
    qc.mockResolvedValue([{ path: 'a.md', snippet: 's' }]);
    await useContentSearchStore.getState().run('abc');
    const s = useContentSearchStore.getState();
    expect(s.term).toBe('abc');
    expect(s.hits).toEqual([{ path: 'a.md', snippet: 's' }]);
    expect(s.loading).toBe(false);
  });

  it('乱序到达：只采纳最新一次查询结果（seq 守卫）', async () => {
    const d1 = deferred<ContentHit[]>(); // 旧查询，后归
    const d2 = deferred<ContentHit[]>(); // 新查询，先归
    qc.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    const p1 = useContentSearchStore.getState().run('old');
    const p2 = useContentSearchStore.getState().run('new');
    d2.resolve([{ path: 'new.md', snippet: 'n' }]);
    await p2;
    expect(useContentSearchStore.getState().hits).toEqual([{ path: 'new.md', snippet: 'n' }]);
    d1.resolve([{ path: 'old.md', snippet: 'o' }]);
    await p1;
    // 旧查询结果被 seq 守卫丢弃，面板仍是 new 的结果。
    expect(useContentSearchStore.getState().hits).toEqual([{ path: 'new.md', snippet: 'n' }]);
    expect(useContentSearchStore.getState().term).toBe('new');
  });

  it('clear 作废在途查询并清空（结果不得回填已清空的面板）', async () => {
    const d = deferred<ContentHit[]>();
    qc.mockReturnValueOnce(d.promise);
    const p = useContentSearchStore.getState().run('abc');
    useContentSearchStore.getState().clear();
    expect(useContentSearchStore.getState().hits).toEqual([]);
    d.resolve([{ path: 'late.md', snippet: 'l' }]);
    await p;
    expect(useContentSearchStore.getState().hits).toEqual([]);
    expect(useContentSearchStore.getState().term).toBe('');
  });
});
