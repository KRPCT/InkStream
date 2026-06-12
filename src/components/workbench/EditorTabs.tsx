import { PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, X, type LucideIcon } from 'lucide-react';
import { execute } from '../../commands/registry';
import { flushAutosave } from '../../stores/autosave';
import { isDraftPath } from '../../editor/draftPath';
import { disposeState, switchToTab } from '../../editor/editorState';
import { confirmDestructive } from '../../stores/useConfirmStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';

/**
 * 编辑器 tab 栏（D-01 标签页模型）：tab 并存、可关闭、带脏标记。
 *
 * 切 tab 经 switchToTab(path)——单内核 view.setState 换装 + 快照 + 滚动还原（D-03）全在
 * editorState 内完成，组件不重复实现。关 tab 先 flushAutosave 落盘再 closeTab + disposeState。
 * 高 36 / 内边距 12 / active 2px 底 accent 指示条 + 600 字重；脏态 6px 圆点 ↔ hover 变 x。
 */

/**
 * 关 tab：先 await flush 落盘（CR-02 必须等落盘完成再释放，否则在途写落到已 dispose 的
 * state / 已切换的活动 tab，叠加 CR-01 会把错误内容写入本文件）→ 释放 state/滚动缓存 → store 移除。
 * 不弹拦截（Ctrl+W 同路）。flush 失败由 autosave 内部保留脏态 + 错误 toast 兜底，仍继续关闭。
 *
 * 草稿（draft://）无落盘路径：脏草稿先弹丢弃确认（取消则保留），确认/干净直接释放——不 flush。
 */
async function closeTabFlow(path: string): Promise<void> {
  if (isDraftPath(path)) {
    const { dirty, tabs } = useEditorStore.getState();
    if (dirty[path] === true) {
      const name = tabs.find((t) => t.path === path)?.name ?? path;
      const ok = await confirmDestructive({
        title: '放弃草稿',
        body: `「${name}」尚未保存，关闭将丢弃全部内容。可先按 Ctrl+S 另存为文件。`,
        confirmLabel: '放弃草稿',
      });
      if (!ok) return;
    }
  } else {
    await flushAutosave(path);
  }
  disposeState(path);
  useEditorStore.getState().closeTab(path);
}

/**
 * tab 栏贴边面板开关（R4 §3.2）：复用 Sidebar HeaderAction 几何（32px 命中区 / 16px 图标 /
 * strokeWidth 1.75 / rounded-[4px]）。图标随开关态切换给视觉反馈，面板已开时高亮（aria-pressed）。
 * onClick 走既有 view.toggle-sidebar / view.toggle-right-panel 命令（零新命令，R4 §3.2 接线）。
 */
function PanelToggle({
  icon: Icon,
  label,
  commandId,
  pressed,
}: {
  icon: LucideIcon;
  label: string;
  commandId: string;
  pressed: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={() => void execute(commandId)}
      className={
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] ' +
        (pressed ? 'bg-[var(--background-modifier-active)] text-[var(--text-normal)]' : '')
      }
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

export default function EditorTabs() {
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const dirty = useEditorStore((s) => s.dirty);
  const sidebarCollapsed = useWorkbenchStore((s) => s.layouts[s.mode].sidebarCollapsed);
  const rightPanelCollapsed = useWorkbenchStore((s) => s.layouts[s.mode].rightPanelCollapsed);

  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-[var(--background-modifier-border)] bg-[var(--background-secondary)]"
    >
      {/* 左端贴边：切换左侧栏（图标随开关态 PanelLeft↔PanelLeftClose） */}
      <div className="flex shrink-0 items-center px-1">
        <PanelToggle
          icon={sidebarCollapsed ? PanelLeft : PanelLeftClose}
          label={sidebarCollapsed ? '展开侧边栏（Ctrl+\\）' : '收起侧边栏（Ctrl+\\）'}
          commandId="view.toggle-sidebar"
          pressed={!sidebarCollapsed}
        />
      </div>
      {tabs.map((tab) => {
        const active = tab.path === activePath;
        const isDirty = dirty[tab.path] === true;
        return (
          <div
            key={tab.path}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => switchToTab(tab.path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') switchToTab(tab.path);
            }}
            className={
              'group flex shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 text-[13px] ' +
              (active
                ? 'border-[var(--accent)] bg-[var(--background-primary)] font-semibold text-[var(--text-normal)]'
                : 'border-transparent font-normal text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]')
            }
          >
            <span className="whitespace-nowrap">{tab.name}</span>
            {/* 脏态 6px 圆点 ↔ hover 变 x：圆点常显于脏态、hover 时让位关闭按钮 */}
            {isDirty ? (
              <span
                data-testid={`dirty-dot-${tab.path}`}
                aria-label="未保存"
                className="h-1.5 w-1.5 rounded-full bg-[var(--text-muted)] group-hover:hidden"
              />
            ) : null}
            <button
              type="button"
              data-testid={`close-tab-${tab.path}`}
              aria-label={`关闭 ${tab.name}`}
              onClick={(e) => {
                e.stopPropagation();
                void closeTabFlow(tab.path);
              }}
              className={
                'flex h-4 w-4 items-center justify-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] ' +
                (isDirty ? 'hidden group-hover:flex' : 'opacity-0 group-hover:opacity-100')
              }
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      {/* 右端贴边：ml-auto 把开关推到 tab 组之后、靠窗口右上（不随 tab 横向滚动消失） */}
      <div className="ml-auto flex shrink-0 items-center px-1">
        <PanelToggle
          icon={rightPanelCollapsed ? PanelRight : PanelRightClose}
          label={rightPanelCollapsed ? '展开右侧面板（Ctrl+Alt+B）' : '收起右侧面板（Ctrl+Alt+B）'}
          commandId="view.toggle-right-panel"
          pressed={!rightPanelCollapsed}
        />
      </div>
    </div>
  );
}
