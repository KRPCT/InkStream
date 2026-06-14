/**
 * Prose-aware diff（Phase 7 DIFF-01）：中英混合**句级**分词（Intl.Segmenter）→ 句级 LCS → 段落保留 → 语义片段。
 *
 * 纯函数、无 DOM/React，用例表单测。区别于行 diff：看「哪句话改了」而非「哪行变了」——
 * 一行内改一个词只标那一句，跨行重排只要句子没变就算未改。
 *
 * 比较以**规范化键**（折叠空白 + trim）为准：纯空白/换行变动不计为改动。段落序号随片段带出，
 * 供渲染按段分组（DIFF-02）。LCS 为 O(n·m)，大文档按章切片 + Worker 化在 DIFF-02 落地（此处只管单块算法）。
 */

export type ProseStatus = 'equal' | 'insert' | 'delete';

/** 一个句级语义片段（render 单元）。 */
export interface ProseDiffSegment {
  /** 原句文本（含原标点/尾随空白，删除取旧、新增/相等取新）。 */
  text: string;
  status: ProseStatus;
  /** 段落序号（按空行切段；新增/相等归新文段号，删除归旧文段号）。 */
  para: number;
}

interface Token {
  text: string;
  /** 规范化比较键（折叠空白 + trim）。 */
  key: string;
  para: number;
}

// granularity:'sentence' 走 ICU 句界规则，中（。！？）英（.!?）混排皆正确；locale 用默认。
const SENTENCE_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'sentence' });

/** 文本 → 句级 token：先按空行切段（保段落结构），每段经 Intl.Segmenter 切句，跳过纯空白句。 */
export function tokenizeProse(text: string): Token[] {
  const out: Token[] = [];
  // 空行（含纯空白行）分段；保留段序。
  const paras = text.split(/\n[ \t]*\n+/);
  paras.forEach((para, pi) => {
    for (const { segment } of SENTENCE_SEGMENTER.segment(para)) {
      const key = segment.replace(/\s+/g, ' ').trim();
      if (key.length === 0) continue;
      out.push({ text: segment, key, para: pi });
    }
  });
  return out;
}

/**
 * 句级 LCS diff：返回有序语义片段（equal/insert/delete）。
 * 相邻 delete+insert 即「改写」，由渲染层成对呈现（本函数只产出基础三态序列）。
 */
export function proseDiff(oldText: string, newText: string): ProseDiffSegment[] {
  const a = tokenizeProse(oldText);
  const b = tokenizeProse(newText);
  const n = a.length;
  const m = b.length;

  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度（自后向前填，便于正向回溯）。
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i].key === b[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const res: ProseDiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].key === b[j].key) {
      res.push({ text: b[j].text, status: 'equal', para: b[j].para });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      res.push({ text: a[i].text, status: 'delete', para: a[i].para });
      i++;
    } else {
      res.push({ text: b[j].text, status: 'insert', para: b[j].para });
      j++;
    }
  }
  while (i < n) {
    res.push({ text: a[i].text, status: 'delete', para: a[i].para });
    i++;
  }
  while (j < m) {
    res.push({ text: b[j].text, status: 'insert', para: b[j].para });
    j++;
  }
  return res;
}

/** diff 是否有实质改动（存在 insert/delete）。 */
export function hasProseChange(segments: ProseDiffSegment[]): boolean {
  return segments.some((s) => s.status !== 'equal');
}
