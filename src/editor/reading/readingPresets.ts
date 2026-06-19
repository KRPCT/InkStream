import type { CSSProperties } from 'react';
import type { ReadingGenre, ReadingTheme } from '../../types/reading';

/**
 * 阅读排版预设（FEAT-READ，模式即数据：集中映射，不在组件里散判）。
 * 文体 → 版式（小说 serif + 宽行距 + 首行缩进；文献 sans + 紧排 + 无缩进 + 窄版心）；
 * 主题 → 表面色（取 theme.css 的 --reading-* token / 应用主题 token，绝不硬编码）。
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
    fontFamily: 'var(--font-editor)',
    lineHeight: 1.75,
    textIndent: '0',
    measure: '46rem',
    textAlign: 'left',
  },
};

/** 阅读主题 → 表面/正文色（token 化，sepia/night 见 theme.css --reading-*）。 */
export const READING_THEMES: Record<ReadingTheme, { bg: string; text: string }> = {
  light: { bg: 'var(--background-primary)', text: 'var(--text-normal)' },
  sepia: { bg: 'var(--reading-sepia-bg)', text: 'var(--reading-sepia-text)' },
  dark: { bg: 'var(--reading-night-bg)', text: 'var(--reading-night-text)' },
};
