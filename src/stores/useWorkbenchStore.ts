import { create } from 'zustand';
import type { AppMode } from '../types/settings';
import { DEFAULT_LAYOUT, type ModeLayout, type TabId } from '../types/workbench';

interface WorkbenchState {
  mode: AppMode;
  /** 三模式各自的面板几何与折叠态（D-10：按模式记忆）。 */
  layouts: Record<AppMode, ModeLayout>;
  activeTab: TabId;
  setMode: (mode: AppMode) => void;
  setLayout: (partial: Partial<ModeLayout>) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  resetCurrentLayout: () => void;
  setActiveTab: (tab: TabId) => void;
}

function initialLayouts(): Record<AppMode, ModeLayout> {
  return {
    standard: { ...DEFAULT_LAYOUT },
    academic: { ...DEFAULT_LAYOUT },
    creative: { ...DEFAULT_LAYOUT },
  };
}

/** 不可变地局部更新当前模式的布局，其它模式保持原引用。 */
function patchCurrent(state: WorkbenchState, patch: Partial<ModeLayout>): Partial<WorkbenchState> {
  return {
    layouts: { ...state.layouts, [state.mode]: { ...state.layouts[state.mode], ...patch } },
  };
}

/**
 * 模式感知的 Workbench 状态层（数据结构在本 plan 定型，D-10）。
 * setMode 仅切数据与 html data-mode（与 settings store 的 data-theme 同构）；
 * 布局应用（Group.setLayout）在 Plan 05 接通，持久化在 Plan 06。
 */
export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  mode: 'standard',
  layouts: initialLayouts(),
  activeTab: 'outline',
  setMode: (mode) => {
    document.documentElement.dataset.mode = mode;
    set({ mode });
  },
  setLayout: (partial) => set((s) => patchCurrent(s, partial)),
  toggleSidebar: () =>
    set((s) => patchCurrent(s, { sidebarCollapsed: !s.layouts[s.mode].sidebarCollapsed })),
  toggleRightPanel: () =>
    set((s) => patchCurrent(s, { rightPanelCollapsed: !s.layouts[s.mode].rightPanelCollapsed })),
  resetCurrentLayout: () => set((s) => patchCurrent(s, { ...DEFAULT_LAYOUT })),
  setActiveTab: (activeTab) => set({ activeTab }),
}));
