import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT } from '../types/workbench';
import { DEFAULT_SETTINGS, validateSettings } from './validateSettings';

const VALID = {
  version: 1,
  theme: 'dark',
  mode: 'academic',
  layouts: {
    standard: { sidebarWidth: 300, rightPanelWidth: 360, sidebarCollapsed: true, rightPanelCollapsed: false },
    academic: { sidebarWidth: 240, rightPanelWidth: 400, sidebarCollapsed: false, rightPanelCollapsed: true },
    creative: { ...DEFAULT_LAYOUT },
  },
  commandMru: ['theme.dark', 'view.toggle-sidebar'],
};

describe('validateSettings', () => {
  it('合法对象原样通过', () => {
    expect(validateSettings(VALID)).toEqual(VALID);
  });

  it('theme 非枚举值回落 system', () => {
    expect(validateSettings({ ...VALID, theme: 'neon' }).theme).toBe('system');
    expect(validateSettings({ ...VALID, theme: 42 }).theme).toBe('system');
  });

  it('mode 非枚举值回落 standard', () => {
    expect(validateSettings({ ...VALID, mode: 'zen' }).mode).toBe('standard');
  });

  it('sidebarWidth 钳制 [200,480]', () => {
    const wide = validateSettings({
      ...VALID,
      layouts: { ...VALID.layouts, standard: { ...VALID.layouts.standard, sidebarWidth: 600 } },
    });
    expect(wide.layouts.standard.sidebarWidth).toBe(480);
    const narrow = validateSettings({
      ...VALID,
      layouts: { ...VALID.layouts, standard: { ...VALID.layouts.standard, sidebarWidth: 150 } },
    });
    expect(narrow.layouts.standard.sidebarWidth).toBe(200);
  });

  it('rightPanelWidth 钳制 [240,560]', () => {
    const out = validateSettings({
      ...VALID,
      layouts: {
        ...VALID.layouts,
        academic: { ...VALID.layouts.academic, rightPanelWidth: 100 },
        creative: { ...VALID.layouts.creative, rightPanelWidth: 9999 },
      },
    });
    expect(out.layouts.academic.rightPanelWidth).toBe(240);
    expect(out.layouts.creative.rightPanelWidth).toBe(560);
  });

  it('数值字段为非数值类型时回默认', () => {
    const out = validateSettings({
      ...VALID,
      layouts: { ...VALID.layouts, standard: { ...VALID.layouts.standard, sidebarWidth: 'wide' } },
    });
    expect(out.layouts.standard.sidebarWidth).toBe(DEFAULT_LAYOUT.sidebarWidth);
  });

  it('layouts 缺键补 DEFAULT_LAYOUT', () => {
    const out = validateSettings({ ...VALID, layouts: { standard: VALID.layouts.standard } });
    expect(out.layouts.academic).toEqual(DEFAULT_LAYOUT);
    expect(out.layouts.creative).toEqual(DEFAULT_LAYOUT);
    expect(out.layouts.standard).toEqual(VALID.layouts.standard);
  });

  it('commandMru 非数组回空数组', () => {
    expect(validateSettings({ ...VALID, commandMru: 'theme.dark' }).commandMru).toEqual([]);
  });

  it('commandMru 过滤非字符串项', () => {
    const out = validateSettings({ ...VALID, commandMru: ['a', 1, null, 'b', {}] });
    expect(out.commandMru).toEqual(['a', 'b']);
  });

  it('commandMru 超过 10 项裁断', () => {
    const ids = Array.from({ length: 15 }, (_, i) => `cmd.${i}`);
    expect(validateSettings({ ...VALID, commandMru: ids }).commandMru).toHaveLength(10);
  });

  it('输入 null / 字符串 / 数组回 DEFAULT_SETTINGS', () => {
    expect(validateSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings('corrupt')).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('version 缺失或非 1 回 DEFAULT_SETTINGS', () => {
    expect(validateSettings({ theme: 'dark' })).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({ ...VALID, version: 2 })).toEqual(DEFAULT_SETTINGS);
  });

  it('DEFAULT_SETTINGS 形状：system + standard + 三模式默认布局 + 空 MRU', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      version: 1,
      theme: 'system',
      mode: 'standard',
      layouts: { standard: DEFAULT_LAYOUT, academic: DEFAULT_LAYOUT, creative: DEFAULT_LAYOUT },
      commandMru: [],
    });
  });

  it('回 DEFAULT_SETTINGS 时返回新副本（不可被调用方污染共享默认值）', () => {
    const a = validateSettings(null);
    a.layouts.standard.sidebarWidth = 999;
    expect(validateSettings(null).layouts.standard.sidebarWidth).toBe(DEFAULT_LAYOUT.sidebarWidth);
  });
});
