import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { extractOutline } from './outline';

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
