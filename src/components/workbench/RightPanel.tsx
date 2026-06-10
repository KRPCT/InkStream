import { MODE_PRESETS, TAB_ICONS, TAB_LABELS } from '../../modes/presets';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import type { TabId } from '../../types/workbench';
import EmptyState from '../common/EmptyState';
import PanelTabs from './PanelTabs';

/** 逐 tab 空态文案（UI-SPEC §逐 tab 空态表逐字）。 */
const TAB_EMPTY: Record<TabId, { heading: string; body: string }> = {
  outline: { heading: '暂无大纲', body: '打开文档后，标题结构会显示在这里。' },
  backlinks: { heading: '暂无反向链接', body: '当其他笔记引用当前文件时，引用会列在这里。' },
  localGraph: { heading: '暂无局部图谱', body: '当前文件建立链接后，这里会显示它的关系网络。' },
  citation: { heading: '暂无引用', body: '在文档中插入 [@citekey] 后，引用条目会列在这里。' },
  typstPreview: { heading: '暂无预览', body: '文档包含 typst 块时，这里会显示编译结果。' },
  codex: { heading: 'Codex 还是空的', body: '角色、地点与设定条目将在这里管理。' },
  sceneSummary: { heading: '暂无场景概要', body: '打开场景后，这里会显示概要卡片。' },
};

/**
 * RightPanel 插槽：tab 集消费 MODE_PRESETS[mode].rightPanelTabs（模式即数据）。
 * keep-alive 限当前模式 tabs 集合内（模式内 display:none 切换，不 unmount）；
 * 跨模式不保活——切模式时非本模式 pane 自然卸载。
 */
export default function RightPanel() {
  const mode = useWorkbenchStore((s) => s.mode);
  const activeTab = useWorkbenchStore((s) => s.activeTab);
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const tabs = MODE_PRESETS[mode].rightPanelTabs;

  return (
    <div className="flex h-full flex-col bg-[var(--background-secondary)]">
      <PanelTabs
        tabs={tabs.map((id) => ({ id, label: TAB_LABELS[id] }))}
        activeTab={activeTab}
        onSelect={setActiveTab}
      />
      <div className="min-h-0 flex-1">
        {tabs.map((id) => (
          <div
            key={id}
            data-testid={`tab-pane-${id}`}
            role="tabpanel"
            aria-labelledby={`tab-${id}`}
            className="h-full"
            style={{ display: activeTab === id ? undefined : 'none' }}
          >
            <EmptyState icon={TAB_ICONS[id]} heading={TAB_EMPTY[id].heading} body={TAB_EMPTY[id].body} />
          </div>
        ))}
      </div>
    </div>
  );
}
