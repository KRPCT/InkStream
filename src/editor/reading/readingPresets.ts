import type { CSSProperties } from 'react';
import type { ReadingGenre, ReadingMargin, ReadingTheme, ReadingWidth } from '../../types/reading';

/**
 * 阅读排版预设（FEAT-READ，模式即数据：集中映射，不在组件里散判）。
 * 文体 → 版式（小说 serif + 宽行距 + 首行缩进；文献 sans + 紧排 + 无缩进 + 窄版心）；
 * 主题 → 表面/正文色。
 *
 * 配色与字体一律用**具体值**，不用 `var(--...)`：正文渲染在 sandbox="" 的隔离 iframe 里（独立文档），
 * 看不到父文档 :root 的 CSS 变量——用变量会全部解析失败、三主题看起来一个样（配色切换失效）。
 * 阅读配色与应用主题正交（护眼用），故取固定值，与落地页阅读演示同一套色板。standalone-doc 字面色豁免。
 */

interface GenrePreset {
  fontFamily: string;
  lineHeight: number;
  /** 段首缩进（小说 2em；文献 0）。 */
  textIndent: string;
  /** 版心最大宽度。 */
  measure: string;
  textAlign: CSSProperties['textAlign'];
}

export const GENRE_PRESETS: Record<ReadingGenre, GenrePreset> = {
  novel: {
    fontFamily: 'Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif',
    lineHeight: 1.9,
    textIndent: '2em',
    measure: '38rem',
    textAlign: 'justify',
  },
  literature: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    lineHeight: 1.75,
    textIndent: '0',
    measure: '46rem',
    textAlign: 'left',
  },
};

/** 阅读主题 → 表面/正文色（具体值；iframe 内无法解析父 :root 变量，见上）。与落地页演示同色板。 */
export const READING_THEMES: Record<ReadingTheme, { bg: string; text: string }> = {
  light: { bg: '#fdfcf8', text: '#23262b' },
  sepia: { bg: '#f3e9d3', text: '#4a3f2c' },
  dark: { bg: '#14171d', text: '#c4cad3' },
};

/** 字体族选择 → 具体字体栈（'auto' 由文体预设决定，不在此表）。与 GENRE_PRESETS 同栈以求一致。 */
export const FONT_STACKS: Record<'serif' | 'sans', string> = {
  serif: 'Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif',
  sans: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
};

/** 版心宽度档位 → max-width（'auto' 用文体预设 measure，不在此表）。文本重排的宽度杠杆。 */
export const WIDTH_MEASURES: Record<Exclude<ReadingWidth, 'auto'>, string> = {
  narrow: '32rem',
  wide: '56rem',
};

/** 页边距档位 → padding（上 左右 下）。'normal' 与旧硬编值一致，杜绝既有观感回归。 */
export const MARGIN_PADDINGS: Record<ReadingMargin, string> = {
  compact: '2rem 1rem 4rem',
  normal: '3rem 1.5rem 6rem',
  roomy: '4rem 3.5rem 8rem',
};
