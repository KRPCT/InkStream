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
  it('短词（<3）不召回，直接收敛空结果', async () => {
    await useProjectSearchStore.getState().run('ab');
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
    expect(read).toHaveBeenCalledWith('D:/v', 'b.md'); // 仅未开的 b.md 读盘
  });

  it('读盘失败（已删）→ 跳过该文件，不抛', async () => {
    qPaths.mockResolvedValue(['gone.md', 'ok.md']);
    read.mockImplementation((_root, path) =>
      path === 'gone.md' ? Promise.reject(new Error('ENOENT')) : Promise.resolve('foo here'),
    );
    await useProjectSearchStore.getState().run('foo');
    expect(useProjectSearchStore.getState().results.map((r) => r.path)).toEqual(['ok.md']);
  });

  it('候选触顶 CAP → truncated', async () => {
    qPaths.mockResolvedValue(Array.from({ length: 500 }, (_, i) => `f${i}.md`));
    read.mockResolvedValue('no match line'); // 无命中，仅验 truncated 标志
    await useProjectSearchStore.getState().run('foobar');
    expect(useProjectSearchStore.getState().truncated).toBe(true);
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
