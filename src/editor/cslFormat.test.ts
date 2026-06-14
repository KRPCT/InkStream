import { describe, expect, it } from 'vitest';
import type { CslItem } from '../types/zotero';
import { formatBibEntry, formatBibliography } from './cslFormat';

/** 参考文献渲染回归门（Phase 8 ZOT-04）。三式格式 + 截断/排序/编号纯函数。 */

const lecun: CslItem = {
  type: 'article-journal',
  title: 'Deep learning',
  'container-title': 'Nature',
  'citation-key': 'lecunDeepLearning2015',
  DOI: '10.1038/nature14539',
  page: '436-444',
  volume: '521',
  author: [
    { family: 'LeCun', given: 'Yann' },
    { family: 'Bengio', given: 'Yoshua' },
    { family: 'Hinton', given: 'Geoffrey' },
  ],
  issued: { 'date-parts': [['2015']] },
};

const hochreiter: CslItem = {
  type: 'article-journal',
  title: 'Long Short-Term Memory',
  'container-title': 'Neural Computation',
  volume: '9',
  issue: '8',
  page: '1735-1780',
  author: [
    { family: 'Hochreiter', given: 'Sepp' },
    { family: 'Schmidhuber', given: 'Jürgen' },
  ],
  issued: { 'date-parts': [['1997']] },
};

const vaswani: CslItem = {
  type: 'paper-conference',
  title: 'Attention Is All You Need',
  'container-title': 'NeurIPS',
  author: [
    { family: 'Vaswani', given: 'Ashish' },
    { family: 'Shazeer', given: 'Noam' },
    { family: 'Parmar', given: 'Niki' },
  ],
  issued: { 'date-parts': [['2017']] },
};

describe('formatBibEntry — GB/T 7714', () => {
  it('期刊文章：作者. 题名[J]. 刊名, 年, 卷(期): 页', () => {
    expect(formatBibEntry(lecun, 'gbt7714')).toBe(
      'LeCun Y, Bengio Y, Hinton G. Deep learning[J]. Nature, 2015, 521: 436-444.',
    );
    expect(formatBibEntry(hochreiter, 'gbt7714')).toBe(
      'Hochreiter S, Schmidhuber J. Long Short-Term Memory[J]. Neural Computation, 1997, 9(8): 1735-1780.',
    );
  });

  it('会议论文标记 [C]', () => {
    expect(formatBibEntry(vaswani, 'gbt7714')).toBe(
      'Vaswani A, Shazeer N, Parmar N. Attention Is All You Need[C]. NeurIPS, 2017.',
    );
  });

  it('作者超 3 取前 3 + 等', () => {
    const many: CslItem = {
      type: 'book',
      title: '某书',
      author: [
        { family: 'A', given: 'X' },
        { family: 'B', given: 'Y' },
        { family: 'C', given: 'Z' },
        { family: 'D', given: 'W' },
      ],
      issued: { 'date-parts': [[2020]] },
    };
    expect(formatBibEntry(many, 'gbt7714')).toBe('A X, B Y, C Z, 等. 某书[M]. 2020.');
  });
});

describe('formatBibEntry — APA', () => {
  it('期刊：姓, I.（年）. 题名. *刊名*, *卷*(期), 页. doi', () => {
    expect(formatBibEntry(lecun, 'apa')).toBe(
      'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. *Nature*, *521*, 436-444. https://doi.org/10.1038/nature14539',
    );
  });

  it('单作者不加 &', () => {
    const solo: CslItem = {
      type: 'book',
      title: 'Solo Work',
      publisher: 'MIT Press',
      author: [{ family: 'Knuth', given: 'Donald E.' }],
      issued: { 'date-parts': [[1968]] },
    };
    expect(formatBibEntry(solo, 'apa')).toBe('Knuth, D. E. (1968). *Solo Work*. MIT Press.');
  });
});

describe('formatBibEntry — Vancouver', () => {
  it('期刊：作者. 题名. 刊名. 年;卷(期):页', () => {
    expect(formatBibEntry(lecun, 'vancouver')).toBe(
      'LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;521:436-444.',
    );
    expect(formatBibEntry(hochreiter, 'vancouver')).toBe(
      'Hochreiter S, Schmidhuber J. Long Short-Term Memory. Neural Computation. 1997;9(8):1735-1780.',
    );
  });

  it('作者超 6 取前 6 + et al.', () => {
    const seven: CslItem = {
      type: 'article-journal',
      title: 'Big',
      'container-title': 'J',
      author: Array.from({ length: 7 }, (_, i) => ({ family: `A${i}`, given: 'X' })),
      issued: { 'date-parts': [[2021]] },
    };
    expect(formatBibEntry(seven, 'vancouver')).toContain('A0 X, A1 X, A2 X, A3 X, A4 X, A5 X, et al.');
  });
});

describe('formatBibliography', () => {
  it('GB/T 按引用序加 [n] 编号、空行分隔', () => {
    const out = formatBibliography([lecun, vaswani], 'gbt7714');
    expect(out).toBe(
      '[1] LeCun Y, Bengio Y, Hinton G. Deep learning[J]. Nature, 2015, 521: 436-444.\n\n' +
        '[2] Vaswani A, Shazeer N, Parmar N. Attention Is All You Need[C]. NeurIPS, 2017.',
    );
  });

  it('APA 按首作者姓字母序、无编号', () => {
    const out = formatBibliography([vaswani, hochreiter], 'apa');
    // Hochreiter < Vaswani → Hochreiter 在前
    expect(out.indexOf('Hochreiter')).toBeLessThan(out.indexOf('Vaswani'));
    expect(out).not.toMatch(/^\[1\]/);
  });

  it('空列表 → 空串', () => {
    expect(formatBibliography([], 'apa')).toBe('');
  });
});
