import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT } from '../types/workbench';
import { useWorkbenchStore } from './useWorkbenchStore';

describe('useWorkbenchStore', () => {
  beforeEach(() => {
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    delete document.documentElement.dataset.mode;
  });

  it('初始：mode=standard、activeTab=outline、三模式布局各为 DEFAULT_LAYOUT', () => {
    const s = useWorkbenchStore.getState();
    expect(s.mode).toBe('standard');
    expect(s.activeTab).toBe('outline');
    expect(s.layouts.standard).toEqual(DEFAULT_LAYOUT);
    expect(s.layouts.academic).toEqual(DEFAULT_LAYOUT);
    expect(s.layouts.creative).toEqual(DEFAULT_LAYOUT);
  });

  it('setMode 切数据并同步写 html data-mode', () => {
    useWorkbenchStore.getState().setMode('academic');
    expect(useWorkbenchStore.getState().mode).toBe('academic');
    expect(document.documentElement.dataset.mode).toBe('academic');
  });

  it('toggleSidebar 只翻转当前模式的 sidebarCollapsed', () => {
    useWorkbenchStore.getState().toggleSidebar();
    const s = useWorkbenchStore.getState();
    expect(s.layouts.standard.sidebarCollapsed).toBe(true);
    expect(s.layouts.academic.sidebarCollapsed).toBe(false);
    expect(s.layouts.creative.sidebarCollapsed).toBe(false);
    useWorkbenchStore.getState().toggleSidebar();
    expect(useWorkbenchStore.getState().layouts.standard.sidebarCollapsed).toBe(false);
  });

  it('toggleRightPanel 只翻转当前模式的 rightPanelCollapsed', () => {
    useWorkbenchStore.getState().setMode('creative');
    useWorkbenchStore.getState().toggleRightPanel();
    const s = useWorkbenchStore.getState();
    expect(s.layouts.creative.rightPanelCollapsed).toBe(true);
    expect(s.layouts.standard.rightPanelCollapsed).toBe(false);
  });

  it('setLayout 局部更新只写当前模式', () => {
    useWorkbenchStore.getState().setLayout({ sidebarWidth: 300 });
    const s = useWorkbenchStore.getState();
    expect(s.layouts.standard.sidebarWidth).toBe(300);
    expect(s.layouts.standard.rightPanelWidth).toBe(DEFAULT_LAYOUT.rightPanelWidth);
    expect(s.layouts.academic.sidebarWidth).toBe(DEFAULT_LAYOUT.sidebarWidth);
  });

  it('resetCurrentLayout 恢复当前模式默认且不动其它模式', () => {
    const store = useWorkbenchStore.getState();
    store.setLayout({ sidebarWidth: 333 });
    store.setMode('academic');
    useWorkbenchStore.getState().setLayout({ rightPanelWidth: 400 });
    useWorkbenchStore.getState().setMode('standard');
    useWorkbenchStore.getState().resetCurrentLayout();
    const s = useWorkbenchStore.getState();
    expect(s.layouts.standard).toEqual(DEFAULT_LAYOUT);
    expect(s.layouts.academic.rightPanelWidth).toBe(400);
  });

  it('setActiveTab 切换右侧面板激活 tab', () => {
    useWorkbenchStore.getState().setActiveTab('backlinks');
    expect(useWorkbenchStore.getState().activeTab).toBe('backlinks');
  });
});
