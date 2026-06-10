/**
 * theme.css 配对测试：解析 CSS 文本断言变量架构与 WCAG 对比度（UI-SPEC 验收表 8 项）。
 * 本测试是变量层的看护门：任何动 theme.css 的变更必须先过此测试。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

// jsdom 环境下 import.meta.url 非 file 协议，按 vitest 运行根（项目根）解析
const css = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8');

/** 提取 html[data-theme='X'] 块体（不含模式组合选择器，前缀互斥保证唯一）。 */
function themeBlock(theme: 'light' | 'dark'): string {
  const m = css.match(new RegExp(`html\\[data-theme='${theme}'\\]\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`theme.css 缺少 html[data-theme='${theme}'] 块`);
  return m[1];
}

/** 块体内取变量值。 */
function varValue(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`块内缺少变量 ${name}`);
  return m[1].trim();
}

/** 提取 6 组合之一的 --accent-hsl 值。 */
function accentValue(mode: string, theme: string): string {
  const m = css.match(
    new RegExp(
      `html\\[data-mode='${mode}'\\]\\[data-theme='${theme}'\\]\\s*\\{\\s*--accent-hsl:\\s*([^;]+);`,
    ),
  );
  if (!m) throw new Error(`theme.css 缺少 ${mode}/${theme} 的 --accent-hsl 声明`);
  return m[1].trim();
}

const NEUTRAL_VARS = [
  '--background-primary',
  '--background-primary-alt',
  '--background-secondary',
  '--background-secondary-alt',
  '--background-modifier-border',
  '--background-modifier-hover',
  '--background-modifier-active',
  '--text-normal',
  '--text-muted',
  '--text-faint',
  '--text-on-accent',
  '--color-error',
  '--mode-dot-standard',
  '--mode-dot-academic',
  '--mode-dot-creative',
];

const ACCENTS: Record<string, { light: string; dark: string }> = {
  standard: { light: '220 10% 50%', dark: '220 14% 71%' },
  academic: { light: '220 70% 45%', dark: '207 82% 66%' },
  creative: { light: '355 65% 50%', dark: '355 65% 65%' },
};

describe('theme.css 变量架构（D-14 立约）', () => {
  it('6 个 --accent-hsl 组合齐备且取值与 UI-SPEC 模式强调色表一致', () => {
    for (const [mode, v] of Object.entries(ACCENTS)) {
      expect(accentValue(mode, 'light')).toBe(v.light);
      expect(accentValue(mode, 'dark')).toBe(v.dark);
    }
  });

  it('变量总表中每个中性变量在 light 与 dark 块各出现一次', () => {
    const light = themeBlock('light');
    const dark = themeBlock('dark');
    for (const name of NEUTRAL_VARS) {
      const re = new RegExp(`${name}:`, 'g');
      expect(light.match(re), `${name} 应在 light 块出现一次`).toHaveLength(1);
      expect(dark.match(re), `${name} 应在 dark 块出现一次`).toHaveLength(1);
    }
  });

  it('--background-modifier-border 照抄 UI-SPEC：light 含 230、dark 含 222', () => {
    expect(varValue(themeBlock('light'), '--background-modifier-border')).toContain('230');
    expect(varValue(themeBlock('dark'), '--background-modifier-border')).toContain('222');
  });

  it('派生层与镜像别名存在（--accent / --text-selection / --titlebar-background）', () => {
    expect(css).toContain('--accent: hsl(var(--accent-hsl))');
    expect(css).toContain('--interactive-accent: hsl(var(--accent-hsl))');
    expect(css).toContain('--text-selection: hsl(var(--accent-hsl) / 0.25)');
    expect(css).toContain('--titlebar-background: var(--background-secondary)');
  });
});

describe('WCAG 验收表 8 项（UI-SPEC §Color）', () => {
  const light = themeBlock('light');
  const dark = themeBlock('dark');
  const bgSecondary = {
    light: varValue(light, '--background-secondary'),
    dark: varValue(dark, '--background-secondary'),
  };

  it('active tab 标签文本（亮）：text-normal vs background-secondary ≥ 4.5', () => {
    expect(contrastRatio(varValue(light, '--text-normal'), bgSecondary.light)).toBeGreaterThanOrEqual(4.5);
  });

  it('active tab 标签文本（暗）：text-normal vs background-secondary ≥ 4.5', () => {
    expect(contrastRatio(varValue(dark, '--text-normal'), bgSecondary.dark)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['standard', 'light'],
    ['academic', 'light'],
    ['creative', 'light'],
    ['standard', 'dark'],
    ['academic', 'dark'],
    ['creative', 'dark'],
  ] as const)('%s %s accent 指示条 vs 同主题 background-secondary ≥ 3.0', (mode, theme) => {
    expect(contrastRatio(accentValue(mode, theme), bgSecondary[theme])).toBeGreaterThanOrEqual(3.0);
  });
});

describe('动效 token 与 reduced-motion 契约', () => {
  it('动效 token 全量声明（UI-SPEC §Interaction）', () => {
    expect(css).toContain('--duration-fast: 100ms');
    expect(css).toContain('--duration-base: 160ms');
    expect(css).toContain('--duration-accent: 150ms');
  });

  it('prefers-reduced-motion 归零块存在且三 token 全部归零', () => {
    const m = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/);
    expect(m, '应存在 prefers-reduced-motion 媒体块').toBeTruthy();
    const block = m![1];
    expect(block).toContain('--duration-fast: 0ms');
    expect(block).toContain('--duration-base: 0ms');
    expect(block).toContain('--duration-accent: 0ms');
  });
});
