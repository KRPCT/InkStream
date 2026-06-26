/**
 * 全库搜索结果模型（#2c 旗舰「可编辑 multibuffer」的纯数据底座）。
 *
 * 无 CodeMirror / IPC 依赖——纯函数，可独立单测。偏移一律 UTF-16 码元（JS 字符串原生单位，与 CM6 同制，
 * 规避字节偏移在中文上的错位）。匹配语义对齐既有 findMatchOffset：字面量、大小写不敏感（与 FTS5 trigram
 * case_sensitive 0 召回同口径）。正则 / 大小写敏感 / 全词留待后续增量。
 */

export interface MatchRange {
  /** 命中在源文件真相源中的 UTF-16 起止偏移。 */
  from: number;
  to: number;
}

export interface ExcerptModel {
  /** 摘录体在源文件中的起止偏移（整行扩展：sourceFrom=首行行首，sourceTo=末行行尾，不含尾换行）。 */
  sourceFrom: number;
  sourceTo: number;
  /** 摘录体文本（自源真相源切片，与 [sourceFrom,sourceTo) 一致）。 */
  text: string;
  /** sourceFrom 所在行号（1 基，多缓冲行号槽展示用）。 */
  firstLine: number;
  /** 落在本摘录内的命中（源偏移，升序）。 */
  matches: MatchRange[];
}

export interface FileMatches {
  path: string;
  matchCount: number;
  excerpts: ExcerptModel[];
}

export interface SearchOpts {
  /** 摘录上下文行数（命中行上下各取几行；相邻/重叠摘录合并）。默认 1。 */
  contextLines?: number;
}

/**
 * 大小写不敏感字面量定位全部不重叠命中（对齐 findMatchOffset：toLowerCase 双侧比较）。
 * 空词返空。注：toLowerCase 对常见中英文本长度守恒，偏移即源偏移；极少数变长折叠（如 ß）不在本应用语料内。
 */
export function findMatches(content: string, query: string): MatchRange[] {
  if (query === '') return [];
  const hay = content.toLowerCase();
  const needle = query.toLowerCase();
  const out: MatchRange[] = [];
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
    out.push({ from: i, to: i + needle.length });
  }
  return out;
}

/** 行起始偏移表（每行行首在 content 中的偏移；至少含 [0]）。 */
function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
  }
  return starts;
}

/** 二分：offset 所在行索引（0 基）。 */
function lineIndexAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * 把命中按上下文行扩展为摘录，相邻/重叠行范围合并；matches 归入各自摘录。
 * 命中须已在 content 内（由 findMatches 产出）；空命中返空。
 */
export function buildExcerpts(
  content: string,
  matches: MatchRange[],
  contextLines: number,
): ExcerptModel[] {
  if (matches.length === 0) return [];
  const starts = lineStarts(content);
  const lastLine = starts.length - 1;
  // 行尾偏移（不含换行）：非末行取下一行行首 -1，末行取 content 末尾。
  const lineEnd = (lineIdx: number): number =>
    lineIdx >= lastLine ? content.length : starts[lineIdx + 1] - 1;

  type Span = { a: number; b: number; matches: MatchRange[] };
  const spans: Span[] = [...matches]
    .sort((x, y) => x.from - y.from)
    .map((m) => {
      const sLine = lineIndexAt(starts, m.from);
      const eLine = lineIndexAt(starts, Math.max(m.from, m.to - 1));
      return {
        a: Math.max(0, sLine - contextLines),
        b: Math.min(lastLine, eLine + contextLines),
        matches: [m],
      };
    });

  // 合并相邻（行号相接 b+1>=a）/ 重叠的行范围。
  const merged: Span[] = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (prev && s.a <= prev.b + 1) {
      prev.b = Math.max(prev.b, s.b);
      prev.matches.push(...s.matches);
    } else {
      merged.push({ a: s.a, b: s.b, matches: [...s.matches] });
    }
  }

  return merged.map((s) => {
    const sourceFrom = starts[s.a];
    const sourceTo = lineEnd(s.b);
    return {
      sourceFrom,
      sourceTo,
      text: content.slice(sourceFrom, sourceTo),
      firstLine: s.a + 1,
      matches: s.matches,
    };
  });
}

/** 摘录文本按命中切分为高亮段（match=true 即命中片段），供结果视图渲染 <mark>。 */
export function excerptSegments(excerpt: ExcerptModel): Array<{ text: string; match: boolean }> {
  const { text, sourceFrom, matches } = excerpt;
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  for (const m of matches) {
    const start = Math.max(0, m.from - sourceFrom);
    const end = Math.min(text.length, m.to - sourceFrom);
    if (start > cursor) parts.push({ text: text.slice(cursor, start), match: false });
    if (end > start) parts.push({ text: text.slice(start, end), match: true });
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}

/** 单文件搜索：真相源内容 + 词 → FileMatches（无命中返 null）。 */
export function searchFile(
  path: string,
  content: string,
  query: string,
  opts: SearchOpts = {},
): FileMatches | null {
  const matches = findMatches(content, query);
  if (matches.length === 0) return null;
  return {
    path,
    matchCount: matches.length,
    excerpts: buildExcerpts(content, matches, opts.contextLines ?? 1),
  };
}
