import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inkstreamHighlightStyle } from './highlightTheme';

// 从仓库根（vitest cwd）读源文本，jsdom 下 import.meta.url 不可靠，故用 process.cwd()。
const root = process.cwd();
const themeCss = readFileSync(resolve(root, 'src/styles/theme.css'), 'utf8');
const highlightSrc = readFileSync(resolve(root, 'src/editor/highlightTheme.ts'), 'utf8');

/** UI-SPEC §Color A 表的 14 个语法高亮 token，亮暗双套。 */
const CM_TOKENS = [
  '--cm-keyword',
  '--cm-string',
  '--cm-comment',
  '--cm-number',
  '--cm-function',
  '--cm-type',
  '--cm-variable',
  '--cm-operator',
  '--cm-heading',
  '--cm-emphasis',
  '--cm-strong',
  '--cm-link',
  '--cm-meta',
  '--cm-invalid',
] as const;

/** 取某个 data-theme 块的文本片段，用于断言变量在该块内定义。 */
function themeBlock(theme: 'light' | 'dark'): string {
  const re = new RegExp(`html\\[data-theme='${theme}'\\]\\s*\\{([\\s\\S]*?)\\}`);
  const m = themeCss.match(re);
  if (!m) throw new Error(`theme.css 缺少 data-theme='${theme}' 块`);
  return m[1];
}

describe('theme.css --cm-* token', () => {
  it('14 个 --cm-* 变量在 light 块均定义', () => {
    const block = themeBlock('light');
    for (const token of CM_TOKENS) {
      expect(block, `light 块缺少 ${token}`).toContain(`${token}:`);
    }
  });

  it('14 个 --cm-* 变量在 dark 块均定义', () => {
    const block = themeBlock('dark');
    for (const token of CM_TOKENS) {
      expect(block, `dark 块缺少 ${token}`).toContain(`${token}:`);
    }
  });

  it('--cm-* 不进入 mode 层（仅随 data-theme 变，不吃 accent）', () => {
    // mode 层只覆写 --accent-hsl，绝不含 --cm-* 取色。
    const modeLines = themeCss
      .split('\n')
      .filter((l) => l.includes('data-mode') && l.includes('--cm-'));
    expect(modeLines).toEqual([]);
  });
});

describe('inkstreamHighlightStyle', () => {
  it('是合法的 HighlightStyle（有 module 属性）', () => {
    expect(inkstreamHighlightStyle).toBeDefined();
    expect(inkstreamHighlightStyle.module).toBeTruthy();
  });

  it('源文件每条 color 均为 var(--cm-*)，无硬编码色值', () => {
    // 不允许 color: '#... 或 color: 'hsl(... 这类硬编码。
    expect(highlightSrc).not.toMatch(/color:\s*['"]#/);
    expect(highlightSrc).not.toMatch(/color:\s*['"]hsl\(/);
    expect(highlightSrc).not.toMatch(/color:\s*['"]rgb/);
  });

  it('引用了全部 14 个 --cm-* 变量', () => {
    for (const token of CM_TOKENS) {
      expect(highlightSrc, `highlightTheme.ts 未引用 ${token}`).toContain(`var(${token})`);
    }
  });

  it('strong 用 font-weight 600（不 700），emphasis 用 italic', () => {
    expect(highlightSrc).toMatch(/fontWeight:\s*['"]?600/);
    expect(highlightSrc).not.toMatch(/fontWeight:\s*['"]?700/);
    expect(highlightSrc).toMatch(/fontStyle:\s*['"]italic/);
  });
});
