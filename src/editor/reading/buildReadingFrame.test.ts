import { describe, expect, it } from 'vitest';
import { buildReadingFrame } from './buildReadingFrame';
import type { ReadingPrefs, ReadingTheme } from '../../types/reading';

const prefs = (theme: ReadingTheme): ReadingPrefs => ({ fontSize: 18, theme });

const bodyColors = (html: string): { bg: string; text: string } => {
  const m = html.match(/body\{background:([^;]+);color:([^;]+);/);
  if (!m) throw new Error('未找到 body 配色');
  return { bg: m[1], text: m[2] };
};

describe('buildReadingFrame', () => {
  it('注入具体色值而非父文档 CSS 变量（sandbox iframe 解析不到父 :root 变量，否则三主题同色）', () => {
    const { bg, text } = bodyColors(buildReadingFrame('<p>hi</p>', 'novel', prefs('sepia')));
    expect(bg).not.toContain('var(');
    expect(text).not.toContain('var(');
  });

  it('三种配色产出三种不同背景色', () => {
    const set = new Set(
      (['light', 'sepia', 'dark'] as const).map((t) => bodyColors(buildReadingFrame('<p>x</p>', 'novel', prefs(t))).bg),
    );
    expect(set.size).toBe(3);
  });

  it('文献文体不留父文档字体变量', () => {
    expect(buildReadingFrame('<p>x</p>', 'literature', prefs('light'))).not.toContain('var(--font-editor)');
  });
});
