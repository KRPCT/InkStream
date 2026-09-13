import { useRef } from 'react';
import type { TabId } from '../../types/workbench';

interface PanelTabsProps {
  tabs: ReadonlyArray<{ id: TabId; label: string }>;
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
}

/**
 * RightPanel 顶部 tab 栏（UI-SPEC 组件状态契约）：高 36、文本 13、水平内边距 12；
 * inactive --text-muted 400 / active --text-normal 600 + 2px 底部 accent 条；
 * focus-visible accent 环由 base.css 全局规则提供。
 */
export default function PanelTabs({ tabs, activeTab, onSelect }: PanelTabsProps) {
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());
  const tabbableTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0]?.id;

  return (
    <div
      role="tablist"
      aria-label="上下文工具"
      className="workbench-tool-tabs flex h-9 shrink-0 items-stretch border-b border-[var(--background-modifier-border)]"
    >
      {tabs.map((tab, index) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) tabRefs.current.set(tab.id, element);
              else tabRefs.current.delete(tab.id);
            }}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`panel-${tab.id}`}
            tabIndex={tab.id === tabbableTab ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => {
              if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
              let nextIndex: number;
              switch (e.key) {
                case 'ArrowLeft':
                  nextIndex = (index - 1 + tabs.length) % tabs.length;
                  break;
                case 'ArrowRight':
                  nextIndex = (index + 1) % tabs.length;
                  break;
                case 'Home':
                  nextIndex = 0;
                  break;
                case 'End':
                  nextIndex = tabs.length - 1;
                  break;
                default:
                  return;
              }
              e.preventDefault();
              const nextTab = tabs[nextIndex];
              tabRefs.current.get(nextTab.id)?.focus();
              onSelect(nextTab.id);
            }}
            className={
              active
                ? 'border-b-2 border-[var(--accent)] px-3 text-[13px] font-semibold text-[var(--text-normal)]'
                : 'border-b-2 border-transparent px-3 text-[13px] font-normal text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]'
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
