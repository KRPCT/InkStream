import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfirmStore } from '../../stores/useConfirmStore';
import { useToastStore } from '../../stores/useToastStore';
import { useVaultStore } from '../../stores/useVaultStore';
import type { TreeNode, VaultInfo } from '../../types/vault';
import { createFileTreeOps, ensureMdExtension, hasIllegalNameChars } from './fileTreeOps';

const createFile = vi.fn().mockResolvedValue(null);
const createDir = vi.fn().mockResolvedValue(null);
const renamePath = vi.fn().mockResolvedValue(null);
const movePath = vi.fn().mockResolvedValue(null);
const trashPath = vi.fn().mockResolvedValue(null);

vi.mock('../../ipc/files', () => ({
  createFile: (...a: unknown[]) => createFile(...a),
  createDir: (...a: unknown[]) => createDir(...a),
  renamePath: (...a: unknown[]) => renamePath(...a),
  movePath: (...a: unknown[]) => movePath(...a),
  trashPath: (...a: unknown[]) => trashPath(...a),
}));

const openFileByPath = vi.fn().mockResolvedValue(undefined);
const refreshTree = vi.fn().mockResolvedValue(undefined);

vi.mock('../../editor/vaultFlow', () => ({
  openFileByPath: (...a: unknown[]) => openFileByPath(...a),
  refreshTree: (...a: unknown[]) => refreshTree(...a),
}));

const VAULT: VaultInfo = { root: '/v', repoRoot: null, name: 'v' };
const TREE: TreeNode[] = [
  { id: 'notes', name: 'notes', isDir: true, children: [] },
  { id: 'a.md', name: 'a.md', isDir: false },
];

function node(id: string, name: string, isDir: boolean): TreeNode {
  return isDir ? { id, name, isDir, children: [] } : { id, name, isDir };
}

beforeEach(() => {
  vi.clearAllMocks();
  useVaultStore.setState({ vault: VAULT, tree: TREE, files: [], expanded: new Set() });
  useToastStore.setState({ toasts: [] });
  useConfirmStore.setState({ request: null });
});

afterEach(() => {
  useConfirmStore.setState({ request: null });
});

describe('ensureMdExtension', () => {
  it('省略扩展名时自动补 .md', () => {
    expect(ensureMdExtension('chapter-1')).toBe('chapter-1.md');
  });

  it('已有扩展名时原样保留（.txt/.rs/.md 不重复补）', () => {
    expect(ensureMdExtension('a.txt')).toBe('a.txt');
    expect(ensureMdExtension('lib.rs')).toBe('lib.rs');
    expect(ensureMdExtension('readme.md')).toBe('readme.md');
  });
});

describe('hasIllegalNameChars（WR-13）', () => {
  it('拒绝含路径分隔符的名字（否则静默变成移动）', () => {
    expect(hasIllegalNameChars('a/b')).toBe(true);
    expect(hasIllegalNameChars('a\\b')).toBe(true);
    expect(hasIllegalNameChars('sub/dir/file')).toBe(true);
  });

  it('拒绝 Windows 保留字符 : * ? " < > |', () => {
    expect(hasIllegalNameChars('a:b')).toBe(true);
    expect(hasIllegalNameChars('a*b')).toBe(true);
    expect(hasIllegalNameChars('a?b')).toBe(true);
    expect(hasIllegalNameChars('a"b')).toBe(true);
    expect(hasIllegalNameChars('a<b')).toBe(true);
    expect(hasIllegalNameChars('a>b')).toBe(true);
    expect(hasIllegalNameChars('a|b')).toBe(true);
  });

  it('接受常规名字（含点、中文、空格、连字符）', () => {
    expect(hasIllegalNameChars('chapter-1.md')).toBe(false);
    expect(hasIllegalNameChars('我的笔记')).toBe(false);
    expect(hasIllegalNameChars('draft v2')).toBe(false);
  });
});

describe('WR-12 父目录含 ":" 时 create 不错位', () => {
  it('parentPath 含冒号：create 仍拼出正确路径（不靠 id 分割）', async () => {
    // 旧实现把 type/parentPath 打包进 id 再按 ':' 分割；父目录含冒号会错位。
    // 现父目录经 onCreate 的 node.data.pending 透传，ops.create 直接 join，永不分割。
    const ops = createFileTreeOps();
    await ops.create({ parentPath: 'C:colon/notes', name: 'todo', isDir: false });
    expect(createFile).toHaveBeenCalledWith('/v', 'C:colon/notes/todo.md');
  });

  it('parentPath 含冒号 + 文件夹：create 拼出正确目录路径', async () => {
    const ops = createFileTreeOps();
    await ops.create({ parentPath: 'a:b/c', name: 'drafts', isDir: true });
    expect(createDir).toHaveBeenCalledWith('/v', 'a:b/c/drafts');
  });
});

describe('fileTreeOps', () => {
  it('新建文件：省略扩展名自动补 .md → createFile → 在编辑器打开（D-10）', async () => {
    const ops = createFileTreeOps();
    await ops.create({ parentPath: '', name: 'intro', isDir: false });
    expect(createFile).toHaveBeenCalledWith('/v', 'intro.md');
    expect(openFileByPath).toHaveBeenCalledWith('intro.md');
    expect(refreshTree).toHaveBeenCalled();
  });

  it('在子目录新建文件：路径前缀拼接父目录', async () => {
    const ops = createFileTreeOps();
    await ops.create({ parentPath: 'notes', name: 'todo', isDir: false });
    expect(createFile).toHaveBeenCalledWith('/v', 'notes/todo.md');
  });

  it('新建文件夹：createDir，不补 .md，不打开编辑器', async () => {
    const ops = createFileTreeOps();
    await ops.create({ parentPath: '', name: 'drafts', isDir: true });
    expect(createDir).toHaveBeenCalledWith('/v', 'drafts');
    expect(createFile).not.toHaveBeenCalled();
    expect(openFileByPath).not.toHaveBeenCalled();
  });

  it('重命名：同目录改名经 renamePath（保留父目录前缀）', async () => {
    const ops = createFileTreeOps();
    await ops.rename(node('notes/a.md', 'a.md', false), 'b.md');
    expect(renamePath).toHaveBeenCalledWith('/v', 'notes/a.md', 'notes/b.md');
    expect(refreshTree).toHaveBeenCalled();
  });

  it('重命名同名冲突：Rust 抛错 → 返回冲突标志，不刷新树（红字交 UI 渲染）', async () => {
    renamePath.mockRejectedValueOnce(new Error('already exists'));
    const ops = createFileTreeOps();
    const result = await ops.rename(node('a.md', 'a.md', false), 'existing.md');
    expect(result.conflict).toBe(true);
    expect(refreshTree).not.toHaveBeenCalled();
  });

  it('删除经 ConfirmDialog 确认后调 trashPath（D-09 回收站 + 确认双保险）', async () => {
    const ops = createFileTreeOps();
    const pending = ops.remove(node('a.md', 'a.md', false));
    // 确认框已弹出，文案含文件名与「回收站」
    const req = useConfirmStore.getState().request;
    expect(req).not.toBeNull();
    expect(req?.body).toContain('a.md');
    expect(req?.body).toContain('回收站');
    req?.resolve(true);
    await pending;
    expect(trashPath).toHaveBeenCalledWith('/v', 'a.md');
    expect(refreshTree).toHaveBeenCalled();
  });

  it('删除被取消：不调 trashPath', async () => {
    const ops = createFileTreeOps();
    const pending = ops.remove(node('a.md', 'a.md', false));
    useConfirmStore.getState().request?.resolve(false);
    await pending;
    expect(trashPath).not.toHaveBeenCalled();
  });

  it('拖拽移动：movePath + Toast「已移动到」+ 撤销反向 movePath', async () => {
    const ops = createFileTreeOps();
    await ops.move(node('a.md', 'a.md', false), 'notes');
    expect(movePath).toHaveBeenCalledWith('/v', 'a.md', 'notes/a.md');
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.message.includes('已移动到'))).toBe(true);
  });

  it('拖拽同名冲突：Toast 错误，绝不调 movePath 覆盖（D-12）', async () => {
    movePath.mockRejectedValueOnce(new Error('target exists'));
    const ops = createFileTreeOps();
    await ops.move(node('a.md', 'a.md', false), 'notes');
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.kind === 'error')).toBe(true);
    // 仅一次失败调用，无第二次覆盖尝试
    expect(movePath).toHaveBeenCalledTimes(1);
  });

  it('无 vault 时各操作静默 no-op（不调 IPC）', async () => {
    useVaultStore.setState({ vault: null });
    const ops = createFileTreeOps();
    await ops.create({ parentPath: '', name: 'x', isDir: false });
    await ops.rename(node('a.md', 'a.md', false), 'b.md');
    await ops.move(node('a.md', 'a.md', false), 'notes');
    expect(createFile).not.toHaveBeenCalled();
    expect(renamePath).not.toHaveBeenCalled();
    expect(movePath).not.toHaveBeenCalled();
  });
});
