import { describe, expect, it } from 'vitest';
import type { OutlineItem } from '../types/editor';
import { computeSectionMove, sectionRanges } from './outlineMove';

/** 应用 changes（升序、互不重叠）到字符串：自后向前，模拟 CM6 ChangeSet 行为以做端到端断言。 */
function apply(doc: string, changes: Array<{ from: number; to?: number; insert?: string }>): string {
  const sorted = [...changes].sort((a, b) => a.from - b.from);
  let out = doc;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = sorted[i];
    out = out.slice(0, c.from) + (c.insert ?? '') + out.slice(c.to ?? c.from);
  }
  return out;
}

/** 从 markdown 抽 H1-H6 标题为 OutlineItem（from = '#' 偏移），构造测试输入。 */
function outline(doc: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let pos = 0;
  for (const line of doc.split('\n')) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) items.push({ level: m[1].length, text: m[2], from: pos });
    pos += line.length + 1;
  }
  return items;
}

describe('sectionRanges', () => {
  it('节区间含全部下级，止于下一同级/更浅标题', () => {
    const doc = '# A\na1\n## A2\nx\n# B\nb1';
    const items = outline(doc); // A@0(1), A2@7(2), B@15(1)
    const r = sectionRanges(items, doc.length);
    expect(r[0]).toEqual({ from: items[0].from, to: items[2].from }); // A → 到 B
    expect(r[1]).toEqual({ from: items[1].from, to: items[2].from }); // A2 → 到 B（更浅）
    expect(r[2]).toEqual({ from: items[2].from, to: doc.length }); // B → 文末
  });
});

describe('computeSectionMove', () => {
  const DOC = '# A\naaa\n# B\nbbb\n# C\nccc\n';

  it('整节移到文末（含其下级），换行规整', () => {
    const items = outline(DOC); // A@0 B@8 C@16
    const move = computeSectionMove(DOC, items, 0, 3)!;
    const out = apply(DOC, move.changes);
    expect(out).toBe('# B\nbbb\n# C\nccc\n# A\naaa\n');
    expect(out.slice(move.caret, move.caret + 3)).toBe('# A'); // caret 落在被移动标题（新 doc 坐标）
  });

  it('整节移到最前', () => {
    const items = outline(DOC);
    const move = computeSectionMove(DOC, items, 2, 0)!;
    expect(apply(DOC, move.changes)).toBe('# C\nccc\n# A\naaa\n# B\nbbb\n');
    expect(move.caret).toBe(0);
  });

  it('末节（无尾换行）移到最前：补尾换行不粘连', () => {
    const doc = '# A\naaa\n# B\nbbb\n# C\nccc'; // 无尾换行
    const items = outline(doc);
    const move = computeSectionMove(doc, items, 2, 0)!;
    expect(apply(doc, move.changes)).toBe('# C\nccc\n# A\naaa\n# B\nbbb\n');
  });

  it('节移到无尾换行的文末：落点前补换行不粘连', () => {
    const doc = '# A\naaa\n# B\nbbb\n# C\nccc'; // 文末无换行
    const items = outline(doc);
    const move = computeSectionMove(doc, items, 0, 3)!;
    expect(apply(doc, move.changes)).toBe('# B\nbbb\n# C\nccc\n# A\naaa\n');
    expect(doc.length).toBeLessThan(apply(doc, move.changes).length); // 整体多了规整换行
    const out = apply(doc, move.changes);
    expect(out.slice(move.caret, move.caret + 3)).toBe('# A');
  });

  it('落点=自身（toIndex===fromIndex）→ null（no-op）', () => {
    const items = outline(DOC);
    expect(computeSectionMove(DOC, items, 1, 1)).toBeNull();
  });

  it('落点=紧邻下一节起点（等于自身节尾）→ null（no-op）', () => {
    const items = outline(DOC);
    expect(computeSectionMove(DOC, items, 0, 1)).toBeNull(); // A 移到 B 之前 = 原位
  });

  it('拖入自身子树 → null（不可把父节落进其子节内）', () => {
    const doc = '# A\n## A2\nx\n# B\ny';
    const items = outline(doc); // A@0(1) A2@4(2) B@12(1)
    expect(computeSectionMove(doc, items, 0, 1)).toBeNull(); // A 落到 A2 之前（A2 在 A 节内）
  });

  it('索引越界 → null', () => {
    const items = outline(DOC);
    expect(computeSectionMove(DOC, items, -1, 0)).toBeNull();
    expect(computeSectionMove(DOC, items, 0, 99)).toBeNull();
    expect(computeSectionMove(DOC, items, 99, 0)).toBeNull();
  });

  it('父节（带子节）整体移动，子节随行', () => {
    const doc = '# A\na\n## A1\naa\n# B\nb\n# C\nc\n';
    const items = outline(doc); // A@0(1) A1(2) B(1) C(1)
    // 把 A（含 A1）移到 C 之前。
    const cIndex = items.findIndex((it) => it.text === 'C');
    const aIndex = items.findIndex((it) => it.text === 'A');
    const move = computeSectionMove(doc, items, aIndex, cIndex)!;
    const out = apply(doc, move.changes);
    expect(out).toBe('# B\nb\n# A\na\n## A1\naa\n# C\nc\n');
  });
});
