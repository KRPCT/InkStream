import { createDir, createFile, movePath, renamePath, trashPath } from '../../ipc/files';
import { openFileByPath, refreshTree } from '../../editor/vaultFlow';
import { confirmDestructive } from '../../stores/useConfirmStore';
import { showToast } from '../../stores/useToastStore';
import { useVaultStore } from '../../stores/useVaultStore';
import type { TreeNode } from '../../types/vault';

/**
 * 文件树写操作纯逻辑（FILE-01）：新建/重命名/删除/移动，各自下发 ipc/files IPC，
 * 成功后回流 useVaultStore.tree（refreshTree）。
 *
 * 从 FileTree.tsx 抽离以便单测（不依赖 react-arborist 虚拟化渲染）；FileTree 把
 * react-arborist 的 onCreate/onRename/onMove/onDelete 接到这些方法。
 * 非 React 模块，经 getState() 读 vault 根（同 vaultFlow / 命令副作用纪律）。
 */

/** 路径分隔统一为 `/`，拼接父目录前缀（空父目录即根）。 */
function join(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** 取相对路径父目录（无父目录返回空串）。 */
function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** 取路径末段（文件/文件夹名）。 */
function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** 省略扩展名（无 `.`）时自动补 .md（D-10）；已有任意扩展名原样保留。 */
export function ensureMdExtension(name: string): string {
  return name.includes('.') ? name : `${name}.md`;
}

/**
 * 文件/文件夹名非法字符校验（WR-13）。
 *
 * 拒绝路径分隔符（`/`、`\\`）——否则 `a/b` 会被 Rust 当作子目录路径，把「重命名」
 * 静默变成「移动」。一并拒绝 Windows 文件名保留字符 `:*?"<>|`（跨平台一致体验）。
 * 纯逻辑可单测，UI 层（onRename）据此返回编辑态并提示。
 */
const ILLEGAL_NAME_CHARS = /[/\\:*?"<>|]/;

export function hasIllegalNameChars(name: string): boolean {
  return ILLEGAL_NAME_CHARS.test(name);
}

export interface CreateArgs {
  /** 父目录相对路径（根目录传 ''）。 */
  parentPath: string;
  /** 用户输入名（文件可省扩展名）。 */
  name: string;
  /** 是否新建文件夹。 */
  isDir: boolean;
}

export interface RenameResult {
  /** 目的地同名冲突（Rust 拒绝，绝不覆盖）：UI 据此渲染行内红字。 */
  conflict: boolean;
}

export interface FileTreeOps {
  create: (args: CreateArgs) => Promise<void>;
  rename: (node: TreeNode, newName: string) => Promise<RenameResult>;
  remove: (node: TreeNode) => Promise<void>;
  move: (node: TreeNode, targetDir: string) => Promise<void>;
}

/** 构造文件树写操作集合（绑定当前 vault 根，绑定时 vault 缺失则各操作 no-op）。 */
export function createFileTreeOps(): FileTreeOps {
  const root = (): string | null => useVaultStore.getState().vault?.root ?? null;

  return {
    async create({ parentPath, name, isDir }) {
      const r = root();
      if (r === null) return;
      if (isDir) {
        await createDir(r, join(parentPath, name));
        await refreshTree();
        return;
      }
      const fileName = ensureMdExtension(name);
      const path = join(parentPath, fileName);
      await createFile(r, path);
      await refreshTree();
      // 新建文件成功后在编辑器打开（D-10）
      await openFileByPath(path);
    },

    async rename(node, newName) {
      const r = root();
      if (r === null) return { conflict: false };
      const to = join(parentOf(node.id), ensureRenameName(node, newName));
      if (to === node.id) return { conflict: false };
      try {
        await renamePath(r, node.id, to);
        await refreshTree();
        return { conflict: false };
      } catch {
        // 同名冲突（Rust 拒绝覆盖）：交 UI 渲染行内红字，不弹 Toast
        return { conflict: true };
      }
    },

    async remove(node) {
      const r = root();
      if (r === null) return;
      const ok = await confirmDestructive({
        title: '删除文件',
        body: `确定要删除「${node.name}」吗？它会被移到系统回收站，可从那里恢复。`,
        confirmLabel: '移到回收站',
      });
      if (!ok) return;
      try {
        await trashPath(r, node.id);
        await refreshTree();
      } catch {
        showToast('error', `无法删除「${node.name}」，请重试。`);
      }
    },

    async move(node, targetDir) {
      const r = root();
      if (r === null) return;
      const to = join(targetDir, node.name);
      if (to === node.id) return;
      try {
        await movePath(r, node.id, to);
        await refreshTree();
        const target = targetDir === '' ? '根目录' : baseName(targetDir);
        showToast('warning', `已移动到「${target}」，可点此撤销。`, () => {
          void undoMove(r, to, node.id);
        });
      } catch {
        // 目标已存在同名项：拒绝并提示，绝不覆盖（D-12）
        showToast('error', '目标位置已存在同名项，移动已取消。');
      }
    },
  };
}

/** 文件夹不补 .md；文件补 .md（与新建一致）。 */
function ensureRenameName(node: TreeNode, newName: string): string {
  return node.isDir ? newName : ensureMdExtension(newName);
}

/** 撤销移动：反向 movePath（失败则提示）。 */
async function undoMove(root: string, from: string, to: string): Promise<void> {
  try {
    await movePath(root, from, to);
    await refreshTree();
  } catch {
    showToast('error', '撤销移动失败，目标位置可能已变化。');
  }
}
