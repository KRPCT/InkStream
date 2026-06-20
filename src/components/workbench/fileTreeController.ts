import type { TreeApi } from 'react-arborist';
import { promptInput } from '../../stores/usePromptStore';
import { showToast } from '../../stores/useToastStore';
import type { TreeNode } from '../../types/vault';
import { createFileTreeOps, hasIllegalNameChars } from './fileTreeOps';

/**
 * 当前挂载文件树的 TreeApi 句柄（模块级单例，同 editor/viewHandle 纪律）。
 *
 * Sidebar 头部图标组与命令面板「折叠全部 / 重命名」经此驱动 react-arborist。
 * FileTree 挂载时 set、卸载时 set(null)。
 */

let handle: TreeApi<TreeNode> | null = null;

export function setFileTreeApi(api: TreeApi<TreeNode> | null): void {
  handle = api;
}

/**
 * 弹名称输入框，在工作区根下新建文件 / 文件夹（经 fileTreeOps 下发 IPC，成功后 refreshTree）。
 *
 * 不再走 react-arborist 行内创建：受控 `data` 模式下 onCreate 返回的占位节点不会进 data，
 * 行内输入框永不渲染，按钮表现为死键。改用自绘 PromptDialog 命名后直接创建，稳定可靠。
 */
async function promptCreate(isDir: boolean): Promise<void> {
  const name = await promptInput({
    title: isDir ? '新建文件夹' : '新建文档',
    label: isDir ? '文件夹名' : '文件名（省略扩展名默认 .md）',
    placeholder: isDir ? '未命名文件夹' : '未命名',
    confirmLabel: '创建',
  });
  const trimmed = name?.trim();
  if (!trimmed) return;
  if (hasIllegalNameChars(trimmed)) {
    showToast('error', '名称不能包含 / \\ : * ? " < > | 等字符。');
    return;
  }
  await createFileTreeOps().create({ parentPath: '', name: trimmed, isDir });
}

/** 新建文件：弹名称输入 → 在根下创建（省略扩展名补 .md）并在编辑器打开。 */
export function newFileInTree(): void {
  void promptCreate(false);
}

/** 新建文件夹：弹名称输入 → 在根下创建目录。 */
export function newFolderInTree(): void {
  void promptCreate(true);
}

/** 折叠全部目录。 */
export function collapseAllInTree(): void {
  handle?.closeAll();
}

/** 把指定 id 的节点选中并进入行内重命名编辑态（命令面板「重命名」入口）。 */
export function renameNodeInTree(id: string): void {
  if (!handle) return;
  handle.select(id);
  void handle.edit(id);
}
