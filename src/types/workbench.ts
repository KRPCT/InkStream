/**
 * Workbench 布局/模式类型契约（Plan 04/05 接口先行）。
 * AppMode 定义在 settings.ts（Plan 02 产物），此处 re-export 供布局层统一引用。
 */
export type { AppMode } from './settings';

/** 单一模式的面板几何与折叠态（D-10 按模式记忆；应用在 Plan 05、持久化在 Plan 06）。 */
export interface ModeLayout {
  sidebarWidth: number;
  rightPanelWidth: number;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
}

/** RightPanel 全部 tab 标识（三模式并集，结构按 D-09 锁定）。 */
export type TabId =
  | 'outline'
  | 'backlinks'
  | 'localGraph'
  | 'citation'
  | 'typstPreview'
  | 'codex'
  | 'sceneSummary';

/** 模式预设形状（MODE_PRESETS 数据本体属 Plan 05 的 src/modes/presets.ts）。 */
export interface ModePreset {
  rightPanelTabs: TabId[];
  sidebar: string;
  label: string;
}

/** 默认布局（UI-SPEC Layout Contract：Sidebar 280 / RightPanel 320，均展开）。 */
export const DEFAULT_LAYOUT: ModeLayout = {
  sidebarWidth: 280,
  rightPanelWidth: 320,
  sidebarCollapsed: false,
  rightPanelCollapsed: false,
};
