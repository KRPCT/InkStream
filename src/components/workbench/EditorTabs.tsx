import { X } from 'lucide-react';
import { flushAutosave } from '../../stores/autosave';
import { disposeState, switchToTab } from '../../editor/editorState';
import { useEditorStore } from '../../stores/useEditorStore';

/**
 * 编辑器 tab 栏（D-01 标签页模型）：tab 并存、可关闭、带脏标记。
 *
 * 切 tab 经 switchToTab(path)——单内核 view.setState 换装 + 快照 + 滚动还原（D-03）全在
 * editorState 内完成，组件不重复实现。关 tab 先 flushAutosave 落盘再 closeTab + disposeState。
 * 高 36 / 内边距 12 / active 2px 底 accent 指示条 + 600 字重；脏态 6px 圆点 ↔ hover 变 x。
 */

/** 关 tab：先 flush 落盘（不弹拦截，Ctrl+W 同路）→ 释放 state/滚动缓存 → store 移除。 */
function closeTabFlow(path: string): void {
  void flushAutosave(path);
  disposeState(path);
  useEditorStore.getState().closeTab(path);
}

export default function EditorTabs() {
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const dirty = useEditorStore((s) => s.dirty);

  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-[var(--background-modifier-border)] bg-[var(--background-secondary)]"
    >
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
                closeTabFlow(tab.path);
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
    </div>
  );
}
