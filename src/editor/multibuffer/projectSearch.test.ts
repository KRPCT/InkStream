import { describe, expect, it } from 'vitest';
import { buildExcerpts, excerptSegments, findMatches, searchFile } from './projectSearch';

describe('findMatches', () => {
  it('大小写不敏感字面量，全部不重叠命中', () => {
    expect(findMatches('aXbxc', 'x')).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 4 },
    ]);
    expect(findMatches('Foo foo FOO', 'foo')).toEqual([
      { from: 0, to: 3 },
      { from: 4, to: 7 },
      { from: 8, to: 11 },
    ]);
  });

  it('中文按 UTF-16 码元定位（与 CM6 同制）', () => {
    // 研(0)究(1)f(2)o(3)o(4)研(5)究(6)
    expect(findMatches('研究foo研究', '研究')).toEqual([
      { from: 0, to: 2 },
      { from: 5, to: 7 },
    ]);
  });

  it('不重叠：重复串只取互不交叠的命中', () => {
    expect(findMatches('aaaa', 'aa')).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });

  it('空词 / 无命中返空', () => {
    expect(findMatches('abc', '')).toEqual([]);
    expect(findMatches('abc', 'xyz')).toEqual([]);
  });
});

describe('buildExcerpts', () => {
  // A\nB\nC\nD\nE：行首 [0,2,4,6,8]，每行单字符。
  const doc = 'A\nB\nC\nD\nE';

  it('单命中按上下文行扩展（context=1）', () => {
    const m = findMatches(doc, 'C'); // 偏移 4
    const ex = buildExcerpts(doc, m, 1);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ sourceFrom: 2, sourceTo: 7, text: 'B\nC\nD', firstLine: 2 });
    expect(ex[0].matches).toEqual([{ from: 4, to: 5 }]);
  });

  it('相邻命中合并为一个摘录', () => {
    const m = findMatches(doc, 'C').concat(findMatches(doc, 'D'));
    const ex = buildExcerpts(doc, m, 1);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ sourceFrom: 2, sourceTo: 9, text: 'B\nC\nD\nE' });
    expect(ex[0].matches.map((x) => x.from).sort((a, b) => a - b)).toEqual([4, 6]);
  });

  it('远隔命中产出独立摘录', () => {
    const m = findMatches(doc, 'A').concat(findMatches(doc, 'E')); // 行0 与 行4
    const ex = buildExcerpts(doc, m, 0); // context=0 不交叠
    expect(ex).toHaveLength(2);
    expect(ex[0]).toMatchObject({ firstLine: 1, text: 'A' });
    expect(ex[1]).toMatchObject({ firstLine: 5, text: 'E' });
  });

  it('上下文在文件边界处 clamp', () => {
    const m = findMatches(doc, 'A'); // 行0，向上无行
    const ex = buildExcerpts(doc, m, 2);
    expect(ex[0].sourceFrom).toBe(0);
    expect(ex[0].firstLine).toBe(1);
    expect(ex[0].text).toBe('A\nB\nC'); // 行0 + 下2行
  });

  it('空命中返空', () => {
    expect(buildExcerpts(doc, [], 1)).toEqual([]);
  });
});

describe('searchFile', () => {
  it('有命中返 FileMatches（matchCount + 摘录），文本与偏移自洽', () => {
    const content = '前言段落\n这里有 foo 一处\n中间\n再次 foo 收尾';
    const fm = searchFile('notes/a.md', content, 'foo', { contextLines: 0 });
    expect(fm?.path).toBe('notes/a.md');
    expect(fm?.matchCount).toBe(2);
    // 每个命中的源偏移切片回原文应等于查询词（大小写不敏感这里同形）。
    for (const ex of fm!.excerpts) {
      for (const mr of ex.matches) {
        expect(content.slice(mr.from, mr.to).toLowerCase()).toBe('foo');
      }
      expect(content.slice(ex.sourceFrom, ex.sourceTo)).toBe(ex.text);
    }
  });

  it('无命中返 null', () => {
    expect(searchFile('a.md', 'nothing here', 'zzz')).toBeNull();
  });
});

describe('excerptSegments', () => {
  const ex = (text: string, matches: Array<{ from: number; to: number }>, sourceFrom = 0) => ({
    sourceFrom,
    sourceTo: sourceFrom + text.length,
    text,
    firstLine: 1,
    matches,
  });

  it('中部命中切为 [前, 命中, 后]', () => {
    expect(excerptSegments(ex('前foo后', [{ from: 1, to: 4 }]))).toEqual([
      { text: '前', match: false },
      { text: 'foo', match: true },
      { text: '后', match: false },
    ]);
  });

  it('首尾命中无空前/后段', () => {
    expect(excerptSegments(ex('foox', [{ from: 0, to: 3 }]))).toEqual([
      { text: 'foo', match: true },
      { text: 'x', match: false },
    ]);
    expect(excerptSegments(ex('xfoo', [{ from: 1, to: 4 }]))).toEqual([
      { text: 'x', match: false },
      { text: 'foo', match: true },
    ]);
  });

  it('多命中交替切分；源偏移随 sourceFrom 平移', () => {
    const segs = excerptSegments(ex('a foo b foo', [{ from: 12, to: 15 }, { from: 18, to: 21 }], 10));
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(['foo', 'foo']);
    expect(segs.map((s) => s.text).join('')).toBe('a foo b foo');
  });

  it('无命中返整段非命中', () => {
    expect(excerptSegments(ex('plain', []))).toEqual([{ text: 'plain', match: false }]);
  });
});
