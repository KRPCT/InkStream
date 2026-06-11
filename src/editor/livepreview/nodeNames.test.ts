import { describe, expect, it } from 'vitest';
import { HIDE_MARK, REVEALABLE } from './nodeNames';

/**
 * lezer 节点名集中表回归门（前向兼容扩展点 1 / RESEARCH「元素识别 via tree」）。
 *
 * HIDE_MARK：标记字符节点（行内隐藏的对象）；REVEALABLE：可还原元素节点（光标进入显源码）。
 * 节点名取自 03-01 的 lezerNodes.test.ts 固化结构（markdown + GFM）。
 */

describe('nodeNames 集中表', () => {
  it('HIDE_MARK 含核心标记节点', () => {
    expect(HIDE_MARK.has('HeaderMark')).toBe(true);
    expect(HIDE_MARK.has('EmphasisMark')).toBe(true);
    expect(HIDE_MARK.has('CodeMark')).toBe(true);
    expect(HIDE_MARK.has('StrikethroughMark')).toBe(true);
    expect(HIDE_MARK.has('LinkMark')).toBe(true);
    expect(HIDE_MARK.has('QuoteMark')).toBe(true);
    expect(HIDE_MARK.has('ListMark')).toBe(true);
  });

  it('REVEALABLE 含标题与强调元素节点', () => {
    for (const h of ['ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6']) {
      expect(REVEALABLE.has(h), `${h} 应在 REVEALABLE`).toBe(true);
    }
    expect(REVEALABLE.has('StrongEmphasis')).toBe(true);
    expect(REVEALABLE.has('Emphasis')).toBe(true);
  });

  it('两表互斥：标记节点不出现在 REVEALABLE，元素节点不出现在 HIDE_MARK', () => {
    for (const mark of HIDE_MARK) {
      expect(REVEALABLE.has(mark), `${mark} 不应同时在 REVEALABLE`).toBe(false);
    }
  });
});
