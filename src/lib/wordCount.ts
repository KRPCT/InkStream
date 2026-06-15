/**
 * 中英混合字数统计——全项目单一真相源（CREA-04 / CREA-01）。
 *
 * 规则（中文写作字数惯例）：CJK 表意字 / 日文假名 / 韩文**每字算一字**；非 CJK 的拉丁词、数字串
 * **整体算一个词**（连字符/撇号在词内，如 don't、mother-in-law）；标点/空白不计。
 * 注意：不用 Intl.Segmenter(word) ——它对 CJK 做词切分（你好世界→你好/世界=2），低于中文「字数」惯例；
 * 这里 CJK 按码点逐字计。StatusBar 今日进度（CREA-04）与章节树每场景计数（CREA-01）共用本函数，保证全局统一/同源。
 *
 * 纯函数、零 CM/store 耦合。调用方须先剔除 frontmatter（传正文，见 editor/frontmatter.ts bodyStart）。
 */

/** CJK 表意字 + 日文假名 + 韩文音节：每字计一（中文写作字数惯例）。 */
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
/** 非 CJK 的字母/数字词（拉丁词、数字串；词内连字符/撇号）。 */
const NON_CJK_WORD = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;

/** 统计文本词数（中英混合）。空串返回 0。仅与 .match/.replace 配合，/g 正则无 lastIndex 残留问题。 */
export function countWords(text: string): number {
  if (!text) return 0;
  const cjk = text.match(CJK_CHAR)?.length ?? 0;
  // 先把 CJK 挖空：CJK 也是 \p{L}，否则会被 NON_CJK_WORD 当拉丁词重复计。
  const rest = text.replace(CJK_CHAR, ' ');
  const words = rest.match(NON_CJK_WORD)?.length ?? 0;
  return cjk + words;
}
