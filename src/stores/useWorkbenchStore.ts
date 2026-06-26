import { create } from 'zustand';
import { MODE_PRESETS } from '../modes/presets';
import type { AppMode } from '../types/settings';
import { DEFAULT_LAYOUT, type ModeLayout, type TabId } from '../types/workbench';

/** 中央区视图：编辑器 / git-graph / 知识图谱 / 合并冲突解决器 / 阅读模式 / 书架 / 全库搜索（multibuffer）整页接管。 */
export type CentralView =
  | 'editor'
  | 'gitGraph'
  | 'graph'
  | 'mergeResolve'
  | 'reading'
  | 'bookshelf'
  | 'multibuffer';

interface WorkbenchState {
  mode: AppMode;
  /** 三模式各自的面板几何与折叠态（D-10：按模式记忆）。 */
  layouts: Record<AppMode, ModeLayout>;
  activeTab: TabId;
  /** 中央区当前视图：'editor' 或 'gitGraph'（GIT-02，切换不卸载 EditorArea，保 CM 实例与 IME）。 */
  centralView: CentralView;
  setMode: (mode: AppMode) => void;
  setLayout: (partial: Partial<ModeLayout>) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  resetCurrentLayout: () => void;
  setActiveTab: (tab: TabId) => void;
  /** 切到指定中央视图；再按同一视图回 'editor'（git.toggle-graph 用）。 */
  toggleCentralView: (view: CentralView) => void;
  setCentralView: (view: CentralView) => void;
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

/** 双写 localStorage 镜像 mode 字段（merge，与 settings store 的 theme 字段互不覆盖）。 */
function writeBootMode(mode: AppMode): void {
  let boot: Record<string, unknown> = {};
  try {
    boot = (JSON.parse(localStorage.getItem('inkstream.boot') ?? '{}') as typeof boot) ?? {};
  } catch {
    boot = {};
  }
  boot.mode = mode;
  try {
    localStorage.setItem('inkstream.boot', JSON.stringify(boot));
  } catch {
    /* 镜像写失败仅影响下次首帧视觉，不阻塞 */
  }
}

/**
 * 模式感知的 Workbench 状态层（D-10 按模式记忆）。
 * setMode 全链路：state.mode + html data-mode（theme.css mode 层切 --accent-hsl）
 * + activeTab 重置为新模式 tabs[0] + boot 镜像；布局恢复由 WorkbenchLayout 订阅 mode
 * 命令式应用（禁 key={mode}），持久化在 Plan 06。
 */
export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  mode: 'standard',
  layouts: initialLayouts(),
  activeTab: 'outline',
  centralView: 'editor',
  setMode: (mode) => {
    document.documentElement.dataset.mode = mode;
    writeBootMode(mode);
    set({ mode, activeTab: MODE_PRESETS[mode].rightPanelTabs[0] });
  },
  setLayout: (partial) => set((s) => patchCurrent(s, partial)),
  toggleSidebar: () =>
    set((s) => patchCurrent(s, { sidebarCollapsed: !s.layouts[s.mode].sidebarCollapsed })),
  toggleRightPanel: () =>
    set((s) => patchCurrent(s, { rightPanelCollapsed: !s.layouts[s.mode].rightPanelCollapsed })),
  resetCurrentLayout: () => set((s) => patchCurrent(s, { ...DEFAULT_LAYOUT })),
  setActiveTab: (activeTab) => set({ activeTab }),
  toggleCentralView: (view) =>
    set((s) => ({ centralView: s.centralView === view ? 'editor' : view })),
  setCentralView: (centralView) => set({ centralView }),
}));
