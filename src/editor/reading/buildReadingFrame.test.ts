import { describe, expect, it } from 'vitest';
import { buildReadingFrame } from './buildReadingFrame';
import type { ReadingPrefs, ReadingTheme } from '../../types/reading';

const prefs = (theme: ReadingTheme, over: Partial<ReadingPrefs> = {}): ReadingPrefs => ({
  fontSize: 18,
  theme,
  fontFamily: 'auto',
  width: 'auto',
  margin: 'normal',
  ...over,
});

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

  it('字体族偏好覆盖文体默认：serif→衬线栈，sans→无衬线栈，auto→文体栈', () => {
    const serif = buildReadingFrame('<p>x</p>', 'literature', prefs('light', { fontFamily: 'serif' }));
    const sans = buildReadingFrame('<p>x</p>', 'novel', prefs('light', { fontFamily: 'sans' }));
    expect(serif).toContain('Georgia');
    expect(sans).toContain('PingFang SC');
  });

  it('版心宽度（文本重排）：窄/宽产出不同 max-width，auto 回落文体版心', () => {
    const width = (w: 'auto' | 'narrow' | 'wide'): string => {
      const m = buildReadingFrame('<p>x</p>', 'novel', prefs('light', { width: w })).match(/max-width:([^;]+);/);
      if (!m) throw new Error('未找到 max-width');
      return m[1];
    };
    expect(new Set([width('auto'), width('narrow'), width('wide')]).size).toBe(3);
    expect(width('narrow')).toBe('32rem');
  });

  it('页边距档位产出不同 padding', () => {
    const pad = (mg: 'compact' | 'normal' | 'roomy'): string => {
      const m = buildReadingFrame('<p>x</p>', 'novel', prefs('light', { margin: mg })).match(/padding:([^;]+);/);
      if (!m) throw new Error('未找到 padding');
      return m[1];
    };
    expect(new Set([pad('compact'), pad('normal'), pad('roomy')]).size).toBe(3);
  });
});
