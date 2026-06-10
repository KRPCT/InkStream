import { describe, expect, it } from 'vitest';
import type { AppMode, TabId } from '../types/workbench';
import { MODE_PRESETS, TAB_ICONS, TAB_LABELS } from './presets';

const ALL_TABS: TabId[] = [
  'outline',
  'backlinks',
  'localGraph',
  'citation',
  'typstPreview',
  'codex',
  'sceneSummary',
];

describe('MODE_PRESETS', () => {
  it('三模式键齐全', () => {
    const modes: AppMode[] = ['standard', 'academic', 'creative'];
    for (const m of modes) expect(MODE_PRESETS[m]).toBeDefined();
    expect(Object.keys(MODE_PRESETS)).toHaveLength(3);
  });

  it('rightPanelTabs 按 D-09 锁定结构', () => {
    expect(MODE_PRESETS.standard.rightPanelTabs).toEqual(['outline', 'backlinks', 'localGraph']);
    expect(MODE_PRESETS.academic.rightPanelTabs).toEqual(['citation', 'typstPreview', 'outline']);
    expect(MODE_PRESETS.creative.rightPanelTabs).toEqual(['codex', 'sceneSummary']);
  });

  it('label 为模式菜单文案（UI-SPEC 逐字）', () => {
    expect(MODE_PRESETS.standard.label).toBe('Standard · 通用');
    expect(MODE_PRESETS.academic.label).toBe('Academic · 学术');
    expect(MODE_PRESETS.creative.label).toBe('Creative · 长篇创作');
  });

  it('sidebar 内容 id 三模式均为 fileTreePlaceholder（本阶段占位）', () => {
    expect(MODE_PRESETS.standard.sidebar).toBe('fileTreePlaceholder');
    expect(MODE_PRESETS.academic.sidebar).toBe('fileTreePlaceholder');
    expect(MODE_PRESETS.creative.sidebar).toBe('fileTreePlaceholder');
  });
});

describe('TAB_LABELS / TAB_ICONS', () => {
  it('tab 中文标签照 UI-SPEC 映射表', () => {
    expect(TAB_LABELS).toEqual({
      outline: '大纲',
      backlinks: '反链',
      localGraph: '局部图谱',
      citation: '引用',
      typstPreview: 'Typst 预览',
      codex: 'Codex',
      sceneSummary: '场景概要',
    });
  });

  it('七个 tab 图标齐备', () => {
    for (const tab of ALL_TABS) expect(TAB_ICONS[tab]).toBeDefined();
  });
});
