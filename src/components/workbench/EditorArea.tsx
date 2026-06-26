import { FileText, FolderOpen } from 'lucide-react';
import { useRef, useState, type MouseEvent } from 'react';
import EmptyState from '../common/EmptyState';
import Breadcrumbs from './Breadcrumbs';
import EditorTabs from './EditorTabs';
import EditorContextMenu, { type MenuPosition } from './EditorContextMenu';
import ExternalChangeBar from './ExternalChangeBar';
import Toolbar from '../../editor/richtext/Toolbar';
import { isComposing } from '../../editor/composition';
import { tableContextFromTarget } from '../../editor/livepreview/tableCommands';
import type { TableMenuContext } from './editorMenuConfig';
import { newDraftDocument } from '../../editor/draftFlow';
import { useCodeMirror } from '../../editor/useCodeMirror';
import { requestOpenFolder } from '../../editor/vaultFlow';
import { getView } from '../../editor/viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';

/** 空态操作按钮（Heading 14/600，沿 UI-SPEC 主操作入口）。 */
function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[14px] font-semibold text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
    >
      {label}
    </button>
  );
}

/**
 * EditorArea：全 App 唯一 CM6 容器 + 二态空态（UI-SPEC 逐空态表）。
 *
 * CM 容器随 App 生命周期常驻（WorkbenchLayout 五插槽永不卸载）——空态只是覆盖层，
 * useCodeMirror 始终挂载在隐藏的 parentRef 上，切 tab 走换装门（editorState）不重建。
 */
export default function EditorArea() {
  const parentRef = useRef<HTMLDivElement | null>(null);
  useCodeMirror(parentRef);
  const vault = useVaultStore((s) => s.vault);
  const activePath = useEditorStore((s) => s.activePath);
  const hasTabs = useEditorStore((s) => s.tabs.length > 0);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [tableCtx, setTableCtx] = useState<TableMenuContext | null>(null);

  /**
   * 编辑器右键：组合期（isComposing）一律不开菜单——铁律「组合期不 dispatch 破坏性操作」，
   * 菜单项都会 dispatch 文本变换/剪贴板，组合中开菜单可能诱发组合期 dispatch，故组合中放行
   * 浏览器默认（不 preventDefault、不 setMenuPos）。非组合期 + 有活动文件才弹自绘菜单。
   *
   * 表格上下文（§5）：从 event.target 上溯解析命中的表格 + 单元格（命中则尾部追加表格操作子菜单）。
   */
  const onContextMenu = (e: MouseEvent<HTMLDivElement>): void => {
    if (!activePath) return;
    const view = getView();
    if (view && isComposing(view)) return;
    e.preventDefault();
    setTableCtx(tableContextFromTarget(e.target));
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      {/* 垂直结构：[Tab 栏 36px] → [外部变更提示条] → [richtext 工具条] → [CM 内容区]。
          Tab 栏只看 hasTabs：草稿（draft://）无 vault 也要有 tab 栏。 */}
      {hasTabs ? <EditorTabs /> : null}
      {/* 外部变更提示条：脏文档外部变更时插入（自身条件渲染，D-04） */}
      <ExternalChangeBar />
      {/* richtext 工具条：frontmatter language=richtext 时显示（D-14，自身条件渲染） */}
      <Toolbar />
      {/* 面包屑栏：光标所在标题路径（#2b，自身条件渲染——无标题路径时整条自隐） */}
      <Breadcrumbs />
      <div className="relative min-h-0 flex-1">
        {/* 单内核 DOM 挂载点：始终存在；无活动文件时由空态覆盖层遮住。
            右键挂此容器（R4 §4.3）：组合期防御见 onContextMenu。 */}
        <div
          ref={parentRef}
          className="h-full overflow-auto"
          data-testid="cm-mount"
          onContextMenu={onContextMenu}
        />
        {menuPos ? (
          <EditorContextMenu
            position={menuPos}
            tableContext={tableCtx}
            onClose={() => setMenuPos(null)}
          />
        ) : null}
        {/* 空态只看 activePath：有活动文档（含无 vault 的草稿）绝不覆盖编辑器。 */}
        {!activePath ? (
          <div className="absolute inset-0 bg-[var(--background-primary)]">
            {!vault ? (
              <EmptyState
                icon={FolderOpen}
                heading="未打开工作区"
                body="新建一个空白文档直接开始写作，或打开文件夹作为工作区。"
                action={
                  <div className="flex items-center justify-center gap-3">
                    <ActionButton label="新建文档" onClick={() => newDraftDocument()} />
                    <ActionButton label="打开文件夹" onClick={() => void requestOpenFolder()} />
                  </div>
                }
              />
            ) : (
              <EmptyState
                icon={FileText}
                heading="未打开文件"
                body="在左侧文件树中选择文件，或按 Ctrl+P 快速打开。"
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
