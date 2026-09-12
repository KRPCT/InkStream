import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../ipc/indexService', () => ({ queryContentPaths: vi.fn() }));
vi.mock('../ipc/files', () => ({ readFile: vi.fn() }));
vi.mock('../editor/editorState', () => ({ getDocForPath: vi.fn() }));

import { getDocForPath } from '../editor/editorState';
import { readFile } from '../ipc/files';
import { queryContentPaths } from '../ipc/indexService';
import { useProjectSearchStore } from './useProjectSearchStore';
import { useVaultStore } from './useVaultStore';

const qPaths = vi.mocked(queryContentPaths);
const read = vi.mocked(readFile);
const docFor = vi.mocked(getDocForPath);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  qPaths.mockReset();
  read.mockReset();
  docFor.mockReset();
  docFor.mockReturnValue(null); // 默认无开启缓冲 → 走 readFile
  useVaultStore.setState({ vault: { root: 'D:/v', repoRoot: null, name: 'v' }, files: [] });
  useProjectSearchStore.setState({ query: '', results: [], totalMatches: 0, truncated: false, status: 'idle' });
});

describe('useProjectSearchStore', () => {
  it('空词不召回，直接收敛空结果', async () => {
    await useProjectSearchStore.getState().run('  ');
    expect(qPaths).not.toHaveBeenCalled();
    expect(useProjectSearchStore.getState()).toMatchObject({ results: [], status: 'done' });
  });

  it('无 vault：不召回，空结果', async () => {
    useVaultStore.setState({ vault: null, files: [] });
    await useProjectSearchStore.getState().run('研究方法');
    expect(qPaths).not.toHaveBeenCalled();
    expect(useProjectSearchStore.getState().status).toBe('done');
  });

  it('候选逐文件搜索 → 结果按路径排序、合计命中数', async () => {
    qPaths.mockResolvedValue(['b.md', 'a.md']);
    read.mockImplementation((_root, path) => Promise.resolve(`hello ${path} foo and foo`));
    await useProjectSearchStore.getState().run('foo');
    const s = useProjectSearchStore.getState();
    expect(s.results.map((r) => r.path)).toEqual(['a.md', 'b.md']); // 已排序
    expect(s.totalMatches).toBe(4); // 每文件 2 处
    expect(s.status).toBe('done');
  });

  it('已开文件取主编辑器真相源（getDocForPath），不读盘', async () => {
    qPaths.mockResolvedValue(['a.md', 'b.md']);
    docFor.mockImplementation((p) => (p === 'a.md' ? '改了的 foo 内容' : null));
    read.mockResolvedValue('盘上 foo 内容');
    await useProjectSearchStore.getState().run('foo');
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith('D:/v', 'b.md', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('任一读盘失败不能伪装成成功完整结果', async () => {
    qPaths.mockResolvedValue(['gone.md', 'ok.md']);
    read.mockImplementation((_root, path) =>
      path === 'gone.md' ? Promise.reject(new Error('ENOENT')) : Promise.resolve('foo here'),
    );
    await useProjectSearchStore.getState().run('foo');
    expect(useProjectSearchStore.getState()).toMatchObject({ results: [], status: 'error', error: expect.stringContaining('gone.md') });
  });

  it('候选超过 CAP 才标记 truncated，且只读取明确的500个候选', async () => {
    qPaths.mockResolvedValue(Array.from({ length: 501 }, (_, i) => `f${i}.md`));
    read.mockResolvedValue('no match line'); // 无命中，仅验 truncated 标志
    await useProjectSearchStore.getState().run('foobar');
    expect(useProjectSearchStore.getState().truncated).toBe(true);
    expect(read).toHaveBeenCalledTimes(500);
  });

  it('短中文逐字查询有真实命中与正确 UTF-16 位置', async () => {
    qPaths.mockResolvedValue(['研究.MD']);
    read.mockResolvedValue('😀前言\r\n研究与研究。');
    await useProjectSearchStore.getState().run('研究');
    expect(qPaths).toHaveBeenCalledWith('研究', 501, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(useProjectSearchStore.getState().totalMatches).toBe(2);
    const matches = useProjectSearchStore.getState().results[0].excerpts[0].matches;
    expect(matches).toEqual([{ from: 6, to: 8, editorFrom: 5 }, { from: 9, to: 11, editorFrom: 8 }]);
  });

  it('读任务串行入场，新的查询会取消旧读取并停止后续文件', async () => {
    qPaths.mockResolvedValueOnce(['old.md', 'never.md']).mockResolvedValueOnce(['new.md']);
    let oldSignal: AbortSignal | undefined;
    read.mockImplementation((_root, path, options) => {
      if (path === 'new.md') return Promise.resolve('新研究。');
      oldSignal = options?.signal;
      return new Promise((_resolve, reject) => oldSignal?.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError')), { once: true }));
    });
    const old = useProjectSearchStore.getState().run('旧');
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    const current = useProjectSearchStore.getState().run('新');
    await Promise.all([old, current]);
    expect(oldSignal?.aborted).toBe(true);
    expect(read.mock.calls.map((args) => args[1])).toEqual(['old.md', 'new.md']);
    expect(useProjectSearchStore.getState().results.map((result) => result.path)).toEqual(['new.md']);
  });

  it('刚好500个候选不伪称截断', async () => {
    qPaths.mockResolvedValue(Array.from({ length: 500 }, (_, i) => `f${i}.md`));
    read.mockResolvedValue('研究');
    await useProjectSearchStore.getState().run('研究');
    expect(useProjectSearchStore.getState()).toMatchObject({ truncated: false, totalMatches: 500, status: 'done' });
  });
  it('单字重复命中过多明确失败，而不因无限收集耗尽内存或给出部分成功', async () => {
    qPaths.mockResolvedValue(['large.md']);
    read.mockResolvedValue('研'.repeat(20_001));
    await useProjectSearchStore.getState().run('研');
    expect(useProjectSearchStore.getState()).toMatchObject({ status: 'error', results: [], error: expect.stringContaining('预算') });
  });

  it('clear 作废在途查询（结果不回填）', async () => {
    const d = deferred<string[]>();
    qPaths.mockReturnValue(d.promise);
    const p = useProjectSearchStore.getState().run('foobar');
    useProjectSearchStore.getState().clear();
    d.resolve(['a.md']);
    await p;
    expect(useProjectSearchStore.getState().results).toEqual([]);
    expect(useProjectSearchStore.getState().status).toBe('idle');
  });
});
