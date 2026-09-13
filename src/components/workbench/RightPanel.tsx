import { useEffect } from 'react';
import { SIMPLE_RIGHT_TABS } from '../../modes/capabilities';
import { MODE_PRESETS, TAB_LABELS } from '../../modes/presets';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import BacklinksPanel from './BacklinksPanel';
import CitationPanel from './CitationPanel';
import CodexPanel from './CodexPanel';
import LocalGraphPanel from './LocalGraphPanel';
import OutlinePanel from './OutlinePanel';
import SceneSummaryPanel from './SceneSummaryPanel';
import TypstPreviewPanel from './TypstPreviewPanel';
import PanelTabs from './PanelTabs';

/**
 * RightPanel 插槽：tab 集消费 MODE_PRESETS[mode].rightPanelTabs（模式即数据）。
 * keep-alive 限当前模式 tabs 集合内（模式内 display:none 切换，不 unmount）；
 * 跨模式不保活——切模式时非本模式 pane 自然卸载。
 */
export default function RightPanel() {
  const mode = useWorkbenchStore((s) => s.mode);
  const activeTab = useWorkbenchStore((s) => s.activeTab);
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const simpleMode = useSettingsStore((s) => s.simpleMode);
  // 简易模式仅留大纲（反链/局部图谱依赖索引，已关）。
  const tabs = simpleMode ? [...SIMPLE_RIGHT_TABS] : MODE_PRESETS[mode].rightPanelTabs;
  const visibleTab = tabs.includes(activeTab) ? activeTab : tabs[0];
  // 能力恢复和项目快照同样可能留下不可用工具；先呈现有效目标，再收敛记忆。
  useEffect(() => {
    if (activeTab !== visibleTab) setActiveTab(visibleTab);
  }, [activeTab, visibleTab, setActiveTab]);

  return (
    <div className="workbench-tools flex h-full flex-col bg-[var(--background-secondary)]">
      <PanelTabs
        tabs={tabs.map((id) => ({ id, label: TAB_LABELS[id] }))}
        activeTab={visibleTab}
        onSelect={setActiveTab}
      />
      <div className="min-h-0 flex-1">
        {tabs.map((id) => (
          <div
            key={id}
            id={`panel-${id}`}
            data-testid={`tab-pane-${id}`}
            role="tabpanel"
            aria-labelledby={`tab-${id}`}
            className="h-full"
            style={{ display: visibleTab === id ? undefined : 'none' }}
          >
            {id === 'backlinks' ? (
              <BacklinksPanel />
            ) : id === 'outline' ? (
              <OutlinePanel />
            ) : id === 'citation' ? (
              <CitationPanel />
            ) : id === 'codex' ? (
              <CodexPanel />
            ) : id === 'sceneSummary' ? (
              <SceneSummaryPanel />
            ) : id === 'localGraph' ? (
              <LocalGraphPanel />
            ) : id === 'typstPreview' ? (
              <TypstPreviewPanel />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
