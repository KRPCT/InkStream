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
  return (
    <div
      role="tablist"
      className="flex h-9 shrink-0 items-stretch border-b border-[var(--background-modifier-border)]"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(tab.id)}
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
