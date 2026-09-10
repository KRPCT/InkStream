import { StickyNote } from 'lucide-react';
import { useSceneSummaryStore } from '../../stores/useSceneSummaryStore';
import { useEditorStore } from '../../stores/useEditorStore';
import EmptyState from '../common/EmptyState';

/**
 * 场景概要面板（CREA-05，RightPanel sceneSummary tab）：显示活动场景 frontmatter summary。
 * 数据 useSceneSummaryStore（editor/sceneSummary 单向镜像）。空 → 逐 tab 空态文案。
 */
export default function SceneSummaryPanel() {
  const summary = useSceneSummaryStore((s) => s.summary);
  const paused = useEditorStore((s) => s.documentBudget?.mode === 'basic');
  if (paused) {
    return <EmptyState icon={StickyNote} heading="场景概要已暂停" body="基础编辑模式下不自动解析文档信息。可在状态栏启用完整排版。" />;
  }
  if (!summary) {
    return (
      <EmptyState icon={StickyNote} heading="暂无场景概要" body="打开场景后，这里会显示概要卡片。" />
    );
  }
  return (
    <div className="h-full overflow-auto p-3 text-[13px] leading-relaxed text-[var(--text-normal)]">
      {summary}
    </div>
  );
}
