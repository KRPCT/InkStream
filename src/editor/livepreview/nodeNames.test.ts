import { describe, expect, it } from 'vitest';
import { HIDE_MARK, LINE_REVEAL_MARK } from './nodeNames';

/**
 * lezer 节点名集中表回归门（前向兼容扩展点 1 / RESEARCH「元素识别 via tree」）。
 *
 * HIDE_MARK：标记字符节点（行内隐藏的对象）。光标行还原已由 inlinePlugin 活动行整行硬跳过统一接管，
 * 旧的逐元素 REVEALABLE 还原集随之退役（删 revealLine.ts 同波）。
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

  it('LINE_REVEAL_MARK 含列表项与引用前缀（逐行还原）', () => {
    expect(LINE_REVEAL_MARK.has('ListMark')).toBe(true);
    expect(LINE_REVEAL_MARK.has('QuoteMark')).toBe(true);
  });
});
