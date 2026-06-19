import type { ReadingGenre } from '../../types/reading';

/**
 * 文体识别（FEAT-READ）：从正文文本的规则启发式猜测 小说 vs 文献。仅扫前 ~50KB 前缀（避免大文档主线程卡顿）。
 * 命中即加分，按分高者判；持平默认文献（学术应用取向）。用户可在工具栏手动覆盖，故只需「足够好」。
 */

const SAMPLE = 50_000;

/** 小说信号：章回标记 / 序章楔子 / Chapter N。 */
const NOVEL_RE: RegExp[] = [
  /第\s*[0-9零一二三四五六七八九十百千两]+\s*[章回卷节折]/,
  /\bchapter\s+\d+/i,
  /(^|\n)\s*(序章|楔子|尾声|后记)\b/,
];
/** 文献信号：摘要 / 关键词 / 参考文献 / 图表编号 / 多级编号小节。 */
const LIT_RE: RegExp[] = [
  /摘\s*要|abstract/i,
  /关\s*键\s*词|key\s?words/i,
  /参\s*考\s*文\s*献|references|bibliography/i,
  /(图|表|figure|fig\.|table)\s*\d+/i,
  /(^|\n)\s*\d+(\.\d+)+\s/,
];

export function detectGenre(text: string): ReadingGenre {
  const s = text.slice(0, SAMPLE);
  let novel = 0;
  let lit = 0;
  for (const re of NOVEL_RE) if (re.test(s)) novel += 1;
  for (const re of LIT_RE) if (re.test(s)) lit += 1;
  // 对白密度：引号占比偏高 → 小说。
  const quotes = (s.match(/[“”「」『』]/g) ?? []).length;
  if (s.length > 0 && quotes / s.length > 0.008) novel += 1;
  return novel > lit ? 'novel' : 'literature';
}
