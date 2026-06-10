import { Link, ListTree, Waypoints, type LucideIcon } from 'lucide-react';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import type { TabId } from '../../types/workbench';
import EmptyState from '../common/EmptyState';
import PanelTabs from './PanelTabs';

interface PaneSpec {
  id: TabId;
  label: string;
  icon: LucideIcon;
  heading: string;
  body: string;
}

/** 本 plan 固定渲染 Standard 三 tab；按模式切换 tab 集属 Plan 05（消费 MODE_PRESETS）。 */
const STANDARD_PANES: PaneSpec[] = [
  {
    id: 'outline',
    label: '大纲',
    icon: ListTree,
    heading: '暂无大纲',
    body: '打开文档后，标题结构会显示在这里。',
  },
  {
    id: 'backlinks',
    label: '反链',
    icon: Link,
    heading: '暂无反向链接',
    body: '当其他笔记引用当前文件时，引用会列在这里。',
  },
  {
    id: 'localGraph',
    label: '局部图谱',
    icon: Waypoints,
    heading: '暂无局部图谱',
    body: '当前文件建立链接后，这里会显示它的关系网络。',
  },
];

/** RightPanel 插槽：tab 栏 + keep-alive 内容区（display:none 切换，不 unmount）。 */
export default function RightPanel() {
  const activeTab = useWorkbenchStore((s) => s.activeTab);
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);

  return (
    <div className="flex h-full flex-col bg-[var(--background-secondary)]">
      <PanelTabs tabs={STANDARD_PANES} activeTab={activeTab} onSelect={setActiveTab} />
      <div className="min-h-0 flex-1">
        {STANDARD_PANES.map((pane) => (
          <div
            key={pane.id}
            data-testid={`tab-pane-${pane.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${pane.id}`}
            className="h-full"
            style={{ display: activeTab === pane.id ? undefined : 'none' }}
          >
            <EmptyState icon={pane.icon} heading={pane.heading} body={pane.body} />
          </div>
        ))}
      </div>
    </div>
  );
}
