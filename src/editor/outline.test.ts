import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { OutlineItem } from '../types/editor';
import { activeHeadingFrom, activeHeadingPath, extractOutline } from './outline';

/** 大纲析出（RightPanel 大纲 tab，Phase 10 前移）。语法树驱动，覆盖 ATX/Setext/闭合式/锚点。 */
function outline(doc: string) {
  return extractOutline(EditorState.create({ doc, extensions: [markdown()] }));
}

describe('extractOutline', () => {
  it('按序析出 ATX 标题与级别', () => {
    const items = outline('# 一级\n\n## 二级\n\n### 三级\n正文');
    expect(items.map((i) => [i.level, i.text])).toEqual([
      [1, '一级'],
      [2, '二级'],
      [3, '三级'],
    ]);
  });

  it('剥首尾 # 与空白（含闭合式 ATX）', () => {
    expect(outline('##   带空格   ##')).toEqual([{ level: 2, text: '带空格', from: 0 }]);
  });

  it('Setext 标题（=/- 下划线）', () => {
    const items = outline('标题\n===\n\n副标题\n---');
    expect(items.map((i) => [i.level, i.text])).toEqual([
      [1, '标题'],
      [2, '副标题'],
    ]);
  });

  it('from 指向标题起始位置（点击导航锚点）', () => {
    const items = outline('前言段落\n\n# 章节');
    expect(items[0]?.from).toBe('前言段落\n\n'.length);
  });

  it('无标题文档 → 空', () => {
    expect(outline('只有正文，没有标题。')).toEqual([]);
  });
});

/** 面包屑 / 大纲活动项的光标→标题路径推导（#2b）。 */
describe('activeHeadingPath', () => {
  const h = (level: number, from: number): OutlineItem => ({ level, text: `H${level}@${from}`, from });
  // H1@0 / H2@10 / H3@20 / H2@30 / H1@40（文档序，from 递增）
  const items = [h(1, 0), h(2, 10), h(3, 20), h(2, 30), h(1, 40)];

  it('光标在首个标题之前 → 空路径（面包屑自隐）', () => {
    expect(activeHeadingPath([h(1, 5)], 0)).toEqual([]);
    expect(activeHeadingFrom([h(1, 5)], 0)).toBeNull();
  });

  it('深层光标回溯出完整祖先链', () => {
    // 光标在 H3@20 段内 → 路径 H1@0 › H2@10 › H3@20
    expect(activeHeadingPath(items, 25).map((i) => i.from)).toEqual([0, 10, 20]);
    expect(activeHeadingFrom(items, 25)).toBe(20);
  });

  it('同级兄弟标题只保留最近祖先（不串入更早的兄弟）', () => {
    // 光标在第二个 H2@30 段内 → H1@0 › H2@30（跳过 H2@10/H3@20）
    expect(activeHeadingPath(items, 35).map((i) => i.from)).toEqual([0, 30]);
  });

  it('回到 H1 段 → 路径仅自身', () => {
    expect(activeHeadingPath(items, 45).map((i) => i.from)).toEqual([40]);
  });

  it('跳级标题（H1 直接到 H3）祖先链仍连到 H1', () => {
    expect(activeHeadingPath([h(1, 0), h(3, 10)], 15).map((i) => i.from)).toEqual([0, 10]);
  });

  it('光标恰在标题起点（from===pos）即归属该标题', () => {
    expect(activeHeadingFrom(items, 10)).toBe(10);
  });
});
