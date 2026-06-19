import type { TabId } from '../types/workbench';

/**
 * 功能能力门（简易模式）。simpleMode 是与 AppMode 正交的全局开关：开启后关闭全部高级功能
 * （索引 / 反链 / 图谱 / 搜索 / git / 引用 / 模式切换 / 字数目标），仅留基础编辑。各消费点读本清单
 * 而非散判 simpleMode，对齐 presets.ts「模式即数据」的收口哲学。
 */
export interface Capabilities {
  /** 允许创建 / 更新 .inkstream 索引库；关闭后 wiki-link 索引、反链、图谱、搜索降级为空。 */
  allowIndex: boolean;
  /** 侧栏全文搜索（依赖索引）。 */
  showSearch: boolean;
  /** 侧栏 git 面板与状态栏分支指示。 */
  showGit: boolean;
  /** 状态栏引用指示（学术）。 */
  showCitation: boolean;
  /** 状态栏模式指示器 / 模式切换入口（简易模式锁定不可切）。 */
  showModeSwitch: boolean;
  /** 状态栏字数目标进度（创作）。 */
  showWordCount: boolean;
}

/** 简易模式下右栏仅保留大纲（不依赖索引；反链 / 局部图谱需索引故隐藏）。 */
export const SIMPLE_RIGHT_TABS: readonly TabId[] = ['outline'];

/** 由 simpleMode 派生能力门。完整模式全开，简易模式全关。 */
export function getCapabilities(simpleMode: boolean): Capabilities {
  return {
    allowIndex: !simpleMode,
    showSearch: !simpleMode,
    showGit: !simpleMode,
    showCitation: !simpleMode,
    showModeSwitch: !simpleMode,
    showWordCount: !simpleMode,
  };
}
