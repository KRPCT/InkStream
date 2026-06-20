import { beforeEach, describe, expect, it, vi } from 'vitest';

const promptInput = vi.fn();
vi.mock('../../stores/usePromptStore', () => ({ promptInput: (...a: unknown[]) => promptInput(...a) }));
const showToast = vi.fn();
vi.mock('../../stores/useToastStore', () => ({ showToast: (...a: unknown[]) => showToast(...a) }));
const create = vi.fn();
vi.mock('./fileTreeOps', () => ({
  createFileTreeOps: () => ({ create, rename: vi.fn(), remove: vi.fn(), move: vi.fn() }),
  hasIllegalNameChars: (n: string) => /[/\\:*?"<>|]/.test(n),
}));

import { newFileInTree, newFolderInTree } from './fileTreeController';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  [promptInput, showToast, create].forEach((m) => m.mockReset());
});

describe('fileTreeController 新建（修复死键：改 PromptDialog 命名后直接创建）', () => {
  it('新建文件：输入名 → 在根下创建（isDir=false）', async () => {
    promptInput.mockResolvedValue('笔记');
    newFileInTree();
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith({ parentPath: '', name: '笔记', isDir: false });
  });

  it('新建文件夹：在根下创建（isDir=true）', async () => {
    promptInput.mockResolvedValue('章节');
    newFolderInTree();
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith({ parentPath: '', name: '章节', isDir: true }));
  });

  it('取消（返回 null）→ 不创建', async () => {
    promptInput.mockResolvedValue(null);
    newFileInTree();
    await flush();
    expect(create).not.toHaveBeenCalled();
  });

  it('空白名 → 不创建', async () => {
    promptInput.mockResolvedValue('   ');
    newFileInTree();
    await flush();
    expect(create).not.toHaveBeenCalled();
  });

  it('含非法字符 → 报错并拒绝创建', async () => {
    promptInput.mockResolvedValue('a/b');
    newFileInTree();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledWith('error', expect.any(String)));
    expect(create).not.toHaveBeenCalled();
  });
});
