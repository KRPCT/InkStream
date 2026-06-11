import type { TreeApi } from 'react-arborist';
import type { TreeNode } from '../../types/vault';

/**
 * 当前挂载文件树的 TreeApi 句柄（模块级单例，同 editor/viewHandle 纪律）。
 *
 * Sidebar 头部图标组与命令面板「新建文件 / 新建文件夹 / 折叠全部」经此触发 react-arborist
 * 行内创建，无需把 TreeApi 提升进 React props 链。FileTree 挂载时 set、卸载时 set(null)。
 */

let handle: TreeApi<TreeNode> | null = null;

export function setFileTreeApi(api: TreeApi<TreeNode> | null): void {
  handle = api;
}

/** 新建文件：在选中目录（或根）下进入行内编辑（提交时下发 IPC）。无树时 no-op。 */
export function newFileInTree(): void {
  void handle?.createLeaf();
}

/** 新建文件夹：同上，createInternal。 */
export function newFolderInTree(): void {
  void handle?.createInternal();
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
