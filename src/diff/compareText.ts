export interface CompareRange { from: number; to: number }
export interface TextComparison {
  mode: 'sentences' | 'text';
  oldRanges: CompareRange[];
  newRanges: CompareRange[];
  note: string;
}

export const SENTENCE_TEXT_LIMIT = 1_000_000;
const TOKEN_LIMIT = 2_000;
const CELL_LIMIT = 2_000_000;

/** CodeMirror displays line endings as LF; offsets must use that same display text. */
export function comparisonDisplayText(text: string): string { return text.replace(/\r\n?/g, '\n'); }

interface Token extends CompareRange { key: string }
function tokens(text: string): Token[] | null {
  const result: Token[] = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  for (const { segment, index } of segmenter.segment(text)) {
    const key = segment.replace(/\s+/g, ' ').trim();
    if (key) result.push({ key, from: index, to: index + segment.length });
    if (result.length > TOKEN_LIMIT) return null;
  }
  return result;
}

export function plainComparison(note = '大文档模式：完整显示两侧正文，句级高亮已暂停。'): TextComparison {
  return { mode: 'text', oldRanges: [], newRanges: [], note };
}

/** Offsets always address the original texts, including blank lines and unchanged sections. */
export function compareFullText(oldText: string, newText: string): TextComparison {
  oldText = comparisonDisplayText(oldText);
  newText = comparisonDisplayText(newText);
  if (oldText === newText) return { mode: 'sentences', oldRanges: [], newRanges: [], note: '两侧正文完全相同。' };
  if (oldText.length + newText.length > SENTENCE_TEXT_LIMIT) return plainComparison();
  const a = tokens(oldText);
  const b = tokens(newText);
  if (!a || !b || (a.length + 1) * (b.length + 1) > CELL_LIMIT) return plainComparison();
  const width = b.length + 1;
  const dp = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * width + j] = a[i].key === b[j].key
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const oldRanges: CompareRange[] = [];
  const newRanges: CompareRange[] = [];
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].key === b[j].key) { i++; j++; }
    else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) { oldRanges.push({ from: a[i].from, to: a[i].to }); i++; }
    else { newRanges.push({ from: b[j].from, to: b[j].to }); j++; }
  }
  for (; i < a.length; i++) oldRanges.push({ from: a[i].from, to: a[i].to });
  for (; j < b.length; j++) newRanges.push({ from: b[j].from, to: b[j].to });
  return { mode: 'sentences', oldRanges, newRanges,
    note: oldRanges.length + newRanges.length === 0 ? '仅空白或换行格式不同，正文已完整保留。' : `句级差异：基线 ${oldRanges.length} 句，目标 ${newRanges.length} 句。` };
}
