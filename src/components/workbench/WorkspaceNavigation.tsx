import { useRef, type KeyboardEvent } from 'react';
import { useWorkbenchStore, type CentralView } from '../../stores/useWorkbenchStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { effectiveCentralView } from '../../stores/effectiveCentralView';

const destinations: Array<{ view: CentralView; label: string; advanced?: boolean }> = [
  { view: 'projectOverview', label: '概览' },
  { view: 'editor', label: '文稿' },
  { view: 'references', label: '文献', advanced: true },
  { view: 'projectVersions', label: '版本', advanced: true },
];

/** 工作区目的地只改变呈现，不创建第二份文档或编辑器状态。 */
export default function WorkspaceNavigation() {
  const requested = useWorkbenchStore((s) => s.centralView);
  const simpleMode = useSettingsStore((s) => s.simpleMode);
  const bookshelfEnabled = useSettingsStore((s) => s.bookshelfEnabled);
  const view = effectiveCentralView(requested, { simpleMode, bookshelfEnabled });
  const tabs = destinations.filter((item) => !simpleMode || !item.advanced);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, tabs.findIndex((item) => item.view === view));
  const navigate = (event: KeyboardEvent, index: number) => {
    if (event.isDefaultPrevented() || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    useWorkbenchStore.getState().setCentralView(tabs[next].view);
    buttons.current[next]?.focus();
  };
  return <div className="workspace-navigation" role="tablist" aria-label="工作区视图">
    {tabs.map((item, index) => <button key={item.view} type="button" role="tab"
      id={`workspace-tab-${item.view}`} aria-controls={`workspace-view-${item.view}`}
      aria-selected={view === item.view} tabIndex={activeIndex === index ? 0 : -1}
      ref={(button) => { buttons.current[index] = button; }} onKeyDown={(event) => navigate(event, index)}
      onClick={() => useWorkbenchStore.getState().setCentralView(item.view)}>{item.label}</button>)}
  </div>;
}
