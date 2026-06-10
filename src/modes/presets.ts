import {
  Eye,
  Link,
  ListTree,
  NotebookTabs,
  Quote,
  StickyNote,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import type { AppMode, ModePreset, TabId } from '../types/workbench';

/**
 * MODE_PRESETS —— 模式差异唯一收口点（Pattern 1「模式即数据」，D-09 结构锁定）。
 * 杜绝 if (mode === 'creative') 散落业务层；后续阶段只向预设加 tab/items，不改 Shell。
 *
 * accent 不进 presets：theme.css 已按 html[data-mode][data-theme] 静态声明 6 组合，
 * JS 只切 data 属性（禁止 style.setProperty 注入色值）。
 */
export const MODE_PRESETS: Record<AppMode, ModePreset> = {
  standard: {
    rightPanelTabs: ['outline', 'backlinks', 'localGraph'],
    sidebar: 'fileTreePlaceholder',
    label: 'Standard · 通用',
  },
  academic: {
    rightPanelTabs: ['citation', 'typstPreview', 'outline'],
    sidebar: 'fileTreePlaceholder',
    label: 'Academic · 学术',
  },
  creative: {
    rightPanelTabs: ['codex', 'sceneSummary'],
    sidebar: 'fileTreePlaceholder',
    label: 'Creative · 长篇创作',
  },
};

/** tab 中文标签（UI-SPEC §RightPanel tab 标签映射表逐字）。 */
export const TAB_LABELS: Record<TabId, string> = {
  outline: '大纲',
  backlinks: '反链',
  localGraph: '局部图谱',
  citation: '引用',
  typstPreview: 'Typst 预览',
  codex: 'Codex',
  sceneSummary: '场景概要',
};

/** tab 空态图标（UI-SPEC §逐 tab 空态表，lucide 单族）。 */
export const TAB_ICONS: Record<TabId, LucideIcon> = {
  outline: ListTree,
  backlinks: Link,
  localGraph: Waypoints,
  citation: Quote,
  typstPreview: Eye,
  codex: NotebookTabs,
  sceneSummary: StickyNote,
};
