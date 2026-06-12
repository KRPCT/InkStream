import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { useMemo } from 'react';
import {
  Tree,
  type CreateHandler,
  type DeleteHandler,
  type MoveHandler,
  type NodeApi,
  type NodeRendererProps,
  type RenameHandler,
} from 'react-arborist';
import { handleToggle, openFileInEditor } from '../../editor/vaultFlow';
import { getView } from '../../editor/viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { showToast } from '../../stores/useToastStore';
import { useVaultStore } from '../../stores/useVaultStore';
import type { TreeNode } from '../../types/vault';
import { setFileTreeApi } from './fileTreeController';
import { createFileTreeOps, hasIllegalNameChars } from './fileTreeOps';

/** 文件夹优先 + Intl.Collator locale 序（D-11，中文按拼音序）。 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 临时新建节点 id 前缀（onRename 提交时经 node.data.pending 取父目录与类型，下发 IPC）。 */
const NEW_PREFIX = '__new__';

/** D-11：隐藏点开头条目（.git 等），其余递归保留并排序。 */
function visibleSorted(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .filter((n) => !n.name.startsWith('.'))
    .slice()
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return collator.compare(a.name, b.name);
    })
    .map((n) => (n.children ? { ...n, children: visibleSorted(n.children) } : n));
}

/** 行内编辑输入（F2 重命名 / 新建命名）：Enter 提交、Esc 取消（react-arborist node.submit/reset）。 */
function RowInput({ node }: { node: NodeApi<TreeNode> }) {
  return (
    <input
      id="filetree-rename-input"
      name="filetree-rename"
      autoFocus
      aria-label="文件名"
      defaultValue={node.data.name}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => node.reset()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') node.submit(e.currentTarget.value);
        else if (e.key === 'Escape') node.reset();
      }}
      className="min-w-0 flex-1 rounded-[3px] border border-[var(--interactive-accent)] bg-[var(--background-primary)] px-1 text-[13px] text-[var(--text-normal)] outline-none"
    />
  );
}

/** 单行渲染：缩进由 style 提供，行内展开箭头 + 图标 + 名称（UI-SPEC 行规格）。 */
function Row({ node, style, dragHandle }: NodeRendererProps<TreeNode>) {
  const dirty = useEditorStore((s) => s.dirty[node.id]);
  const isActive = useEditorStore((s) => s.activePath === node.id);
  const Icon = node.isInternal ? (node.isOpen ? FolderOpen : Folder) : File;
  return (
    <div
      ref={dragHandle}
      style={style}
      role="treeitem"
      aria-selected={isActive}
      onClick={() => {
        if (node.isEditing) return;
        if (node.isInternal) {
          node.toggle();
          return;
        }
        const view = getView();
        if (view) void openFileInEditor(view, node.data);
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2') {
          e.preventDefault();
          node.edit();
        } else if (e.key === 'Delete') {
          e.preventDefault();
          void createFileTreeOps().remove(node.data);
        }
      }}
      className={`flex h-[28px] cursor-pointer items-center gap-1 px-2 text-[13px] ${
        isActive
          ? 'bg-[var(--background-modifier-active)] font-semibold text-[var(--text-normal)]'
          : 'text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]'
      }`}
    >
      <ChevronRight
        size={12}
        strokeWidth={1.75}
        aria-hidden="true"
        className={`shrink-0 text-[var(--text-muted)] transition-transform ${
          node.isInternal ? '' : 'invisible'
        } ${node.isOpen ? 'rotate-90' : ''}`}
      />
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
      {node.isEditing ? (
        <RowInput node={node} />
      ) : (
        <span className="truncate">{node.data.name}</span>
      )}
      {dirty && !node.isEditing ? (
        <span
          aria-hidden="true"
          className="ml-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
        />
      ) : null}
    </div>
  );
}

/**
 * react-arborist 受控 `data` 文件树（A2/Pitfall 5）。indent 16 / 行高 28（UI-SPEC）。
 * 点击打开 / 展开目录 + onCreate/onRename/onMove/onDelete 四回调下发 ipc/files IPC
 * （fileTreeOps），成功后回流 useVaultStore.tree（refreshTree）。
 */
export default function FileTree() {
  const tree = useVaultStore((s) => s.tree);
  const data = visibleSorted(tree);
  const ops = useMemo(() => createFileTreeOps(), []);

  // D-08 持久化展开态回喂：仅取挂载首帧的 expanded 作 react-arborist 初始开合态
  // （后续开合由 onToggle → store 单向驱动；initialOpenState 是「初始」语义，不随渲染更新）。
  const initialOpenState = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const id of useVaultStore.getState().expanded) map[id] = true;
    return map;
  }, []);

  // 新建：返回临时占位节点。父目录与类型挂在 node.data.pending（WR-12），
  // 不再编码进 id 串——父目录路径含 ':' 时按 id 分割会错位。
  const onCreate: CreateHandler<TreeNode> = ({ parentNode, type }) => {
    const parentPath = parentNode?.data.id ?? '';
    return {
      id: `${NEW_PREFIX}:${Date.now()}`,
      name: '',
      isDir: type === 'internal',
      pending: { parentPath, isDir: type === 'internal' },
    };
  };

  const onRename: RenameHandler<TreeNode> = async ({ node, name }) => {
    const trimmed = name.trim();
    if (!trimmed) {
      node.reset();
      return;
    }
    // WR-13：拒绝含路径分隔符 / OS 非法字符的名字（否则 a/b 会静默变成移动到子目录）。
    if (hasIllegalNameChars(trimmed)) {
      showToast('error', '名称不能包含 / \\ : * ? " < > | 等字符。');
      node.edit(); // 回到编辑态让用户改名
      return;
    }
    const item = node.data;
    if (item.pending) {
      await ops.create({ parentPath: item.pending.parentPath, name: trimmed, isDir: item.pending.isDir });
      return;
    }
    const result = await ops.rename(item, trimmed);
    if (result.conflict) node.edit(); // 同名冲突：重回编辑态，提示换名
  };

  const onMove: MoveHandler<TreeNode> = async ({ dragNodes, parentNode }) => {
    const targetDir = parentNode?.data.id ?? '';
    for (const dn of dragNodes) await ops.move(dn.data, targetDir);
  };

  const onDelete: DeleteHandler<TreeNode> = async ({ nodes }) => {
    for (const n of nodes) await ops.remove(n.data);
  };

  return (
    <Tree<TreeNode>
      ref={(api) => setFileTreeApi(api ?? null)}
      data={data}
      idAccessor="id"
      childrenAccessor={(d) => d.children ?? null}
      indent={16}
      rowHeight={28}
      width="100%"
      initialOpenState={initialOpenState}
      onToggle={(id) => void handleToggle(id)}
      onCreate={onCreate}
      onRename={onRename}
      onMove={onMove}
      onDelete={onDelete}
    >
      {Row}
    </Tree>
  );
}
