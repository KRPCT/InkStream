import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  entriesToNodes,
  expandDir,
  handleToggle,
  refreshTree,
  updateNodeChildren,
} from './vaultFlow';
import { useVaultStore } from '../stores/useVaultStore';
import type { TreeEntry, TreeNode, VaultInfo } from '../types/vault';

const listDir = vi.fn<(root: string, rel: string) => Promise<TreeEntry[]>>();
const listFiles = vi.fn().mockResolvedValue([]);
const openVault = vi.fn();
vi.mock('../ipc/vault', () => ({
  openVault: (p: string) => openVault(p),
  listDir: (root: string, rel: string) => listDir(root, rel),
  listFiles: (root: string) => listFiles(root),
}));

const INFO: VaultInfo = { root: '/v', repoRoot: null, name: 'v' };

/** notes/（未加载目录）+ a.md 的初始根树（与 openVaultByPath 回流形状一致）。 */
function rootTree(): TreeNode[] {
  return [
    { id: 'notes', name: 'notes', isDir: true, children: [], loaded: false },
    { id: 'a.md', name: 'a.md', isDir: false },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  listDir.mockResolvedValue([]);
  useVaultStore.setState(useVaultStore.getInitialState(), true);
  useVaultStore.setState({ vault: INFO, tree: rootTree() });
});

describe('entriesToNodes', () => {
  it('目录给空 children + loaded:false（待懒加载）；文件无 children', () => {
    const nodes = entriesToNodes([
      { name: 'b.md', path: 'b.md', isDir: false },
      { name: 'sub', path: 'sub', isDir: true },
    ]);
    // 文件夹优先排序
    expect(nodes[0]).toEqual({ id: 'sub', name: 'sub', isDir: true, children: [], loaded: false });
    expect(nodes[1]).toEqual({ id: 'b.md', name: 'b.md', isDir: false });
  });
});

describe('updateNodeChildren（纯合并助手）', () => {
  it('按 id 替换目标目录 children 并标 loaded:true，其它节点引用不变', () => {
    const tree = rootTree();
    const kids = entriesToNodes([{ name: 'todo.md', path: 'notes/todo.md', isDir: false }]);
    const next = updateNodeChildren(tree, 'notes', kids);
    expect(next[0].children).toEqual(kids);
    expect(next[0].loaded).toBe(true);
    // a.md 节点引用未变（最小变更，避免整树重建）
    expect(next[1]).toBe(tree[1]);
  });

  it('深层目录也能命中合并', () => {
    useVaultStore.setState({
      tree: [
        {
          id: 'notes',
          name: 'notes',
          isDir: true,
          loaded: true,
          children: [{ id: 'notes/sub', name: 'sub', isDir: true, children: [], loaded: false }],
        },
      ],
    });
    const kids = entriesToNodes([{ name: 'x.md', path: 'notes/sub/x.md', isDir: false }]);
    const next = updateNodeChildren(useVaultStore.getState().tree, 'notes/sub', kids);
    expect(next[0].children?.[0].children).toEqual(kids);
    expect(next[0].children?.[0].loaded).toBe(true);
  });

  it('未命中 id：原样返回同一引用（无变更）', () => {
    const tree = rootTree();
    expect(updateNodeChildren(tree, 'missing', [])).toBe(tree);
  });
});

describe('expandDir（懒加载子项）', () => {
  it('展开未加载目录：listDir(root, dirPath) → 合并 children + loaded:true', async () => {
    listDir.mockResolvedValueOnce([{ name: 'todo.md', path: 'notes/todo.md', isDir: false }]);
    await expandDir('notes');
    expect(listDir).toHaveBeenCalledWith('/v', 'notes');
    const notes = useVaultStore.getState().tree[0];
    expect(notes.loaded).toBe(true);
    expect(notes.children).toEqual([{ id: 'notes/todo.md', name: 'todo.md', isDir: false }]);
  });

  it('已加载目录不重复取盘（loaded:true → no-op）', async () => {
    useVaultStore.setState({
      tree: [{ id: 'notes', name: 'notes', isDir: true, loaded: true, children: [] }],
    });
    await expandDir('notes');
    expect(listDir).not.toHaveBeenCalled();
  });

  it('空文件夹：加载后 children:[] + loaded:true（不渲染子行，且不再重取）', async () => {
    listDir.mockResolvedValueOnce([]);
    await expandDir('notes');
    expect(useVaultStore.getState().tree[0]).toMatchObject({ loaded: true, children: [] });
    await expandDir('notes'); // 第二次不应再 listDir
    expect(listDir).toHaveBeenCalledTimes(1);
  });

  it('无 vault：静默 no-op', async () => {
    useVaultStore.setState({ vault: null });
    await expandDir('notes');
    expect(listDir).not.toHaveBeenCalled();
  });
});

describe('handleToggle（开合 → 同步 store.expanded + 懒加载）', () => {
  it('打开未加载目录：写入 expanded 并懒加载', async () => {
    listDir.mockResolvedValueOnce([{ name: 'todo.md', path: 'notes/todo.md', isDir: false }]);
    await handleToggle('notes');
    expect(useVaultStore.getState().expanded.has('notes')).toBe(true);
    expect(listDir).toHaveBeenCalledWith('/v', 'notes');
  });

  it('再次切换（折叠）：从 expanded 移除，不再 listDir', async () => {
    useVaultStore.setState({
      expanded: new Set(['notes']),
      tree: [{ id: 'notes', name: 'notes', isDir: true, loaded: true, children: [] }],
    });
    await handleToggle('notes');
    expect(useVaultStore.getState().expanded.has('notes')).toBe(false);
    expect(listDir).not.toHaveBeenCalled();
  });
});

describe('refreshTree 保留已展开子树（不塌陷）', () => {
  it('写操作后重列根并重水合已加载目录（展开的 notes/ 子项不消失）', async () => {
    // 先展开 notes/ 使其 loaded:true 且含一个子文件
    listDir.mockResolvedValueOnce([{ name: 'todo.md', path: 'notes/todo.md', isDir: false }]);
    await expandDir('notes');
    expect(useVaultStore.getState().tree[0].loaded).toBe(true);

    // refreshTree：根重列（含 notes + 新建 b.md）+ notes 子目录重列（多了 new.md）
    listDir.mockImplementation(async (_root, rel) => {
      if (rel === '') {
        return [
          { name: 'notes', path: 'notes', isDir: true },
          { name: 'a.md', path: 'a.md', isDir: false },
          { name: 'b.md', path: 'b.md', isDir: false },
        ];
      }
      if (rel === 'notes') {
        return [
          { name: 'todo.md', path: 'notes/todo.md', isDir: false },
          { name: 'new.md', path: 'notes/new.md', isDir: false },
        ];
      }
      return [];
    });

    await refreshTree();
    const tree = useVaultStore.getState().tree;
    const notes = tree.find((n) => n.id === 'notes');
    // 关键回归：notes 仍 loaded 且其子项已重水合（未塌陷为空）
    expect(notes?.loaded).toBe(true);
    expect(notes?.children?.map((c) => c.id).sort()).toEqual(['notes/new.md', 'notes/todo.md']);
    // 根新增 b.md 也已纳入
    expect(tree.some((n) => n.id === 'b.md')).toBe(true);
  });

  it('未展开的目录刷新后仍是未加载态（loaded:false），不被无谓重取', async () => {
    listDir.mockResolvedValue([
      { name: 'notes', path: 'notes', isDir: true },
      { name: 'a.md', path: 'a.md', isDir: false },
    ]);
    await refreshTree();
    // 只列了根（''）一次，没有为未加载的 notes 取子目录
    expect(listDir).toHaveBeenCalledWith('/v', '');
    expect(listDir).not.toHaveBeenCalledWith('/v', 'notes');
    expect(useVaultStore.getState().tree[0].loaded).toBe(false);
  });
});
