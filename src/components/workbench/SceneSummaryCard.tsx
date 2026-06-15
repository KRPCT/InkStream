import { useState } from 'react';
import { ChevronDown, ChevronRight, StickyNote } from 'lucide-react';
import { useSceneSummaryStore } from '../../stores/useSceneSummaryStore';

/**
 * 场景概要卡片（CREA-05，Creative 模式编辑器顶，可折叠）。读 useSceneSummaryStore；无概要则不渲染（不占位）。
 * v1 只读展示（编辑 summary 直接改 frontmatter，卡片随 docChanged 镜像更新）。
 */
export default function SceneSummaryCard() {
  const summary = useSceneSummaryStore((s) => s.summary);
  const [collapsed, setCollapsed] = useState(false);

  if (!summary) return null;

  return (
    <div className="shrink-0 border-b border-[var(--background-modifier-border)] bg-[var(--background-secondary)] px-3 py-1">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-normal)]"
      >
        {collapsed ? (
          <ChevronRight size={12} aria-hidden="true" />
        ) : (
          <ChevronDown size={12} aria-hidden="true" />
        )}
        <StickyNote size={12} aria-hidden="true" />
        <span>场景概要</span>
      </button>
      {!collapsed ? (
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-normal)]">{summary}</p>
      ) : null}
    </div>
  );
}
