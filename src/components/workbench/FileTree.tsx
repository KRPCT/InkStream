import { ChevronRight, File, Folder, FolderOpen } from 'lucide-react';
import { Tree, type NodeRendererProps } from 'react-arborist';
import { openFileInEditor } from '../../editor/vaultFlow';
import { getView } from '../../editor/viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import type { TreeNode } from '../../types/vault';

/** 文件夹优先 + Intl.Collator locale 序（D-11，中文按拼音序）。 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

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
        if (node.isInternal) {
          node.toggle();
          return;
        }
        const view = getView();
        if (view) void openFileInEditor(view, node.data);
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
      <span className="truncate">{node.data.name}</span>
      {dirty ? (
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
 * 本任务仅「点击打开文件 / 展开目录」交互；新建/重命名/拖拽/删除属 02-03。
 */
export default function FileTree() {
  const tree = useVaultStore((s) => s.tree);
  const data = visibleSorted(tree);
  return (
    <Tree<TreeNode>
      data={data}
      idAccessor="id"
      childrenAccessor={(d) => d.children ?? null}
      indent={16}
      rowHeight={28}
      width="100%"
      disableDrag
      disableDrop
    >
      {Row}
    </Tree>
  );
}
