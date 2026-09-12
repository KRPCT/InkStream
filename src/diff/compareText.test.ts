import { describe, expect, it } from 'vitest';
import { compareFullText, comparisonDisplayText, SENTENCE_TEXT_LIMIT } from './compareText';

describe('完整正文句级比较', () => {
  it('保留首尾未改正文和空行，中文改句只产生对应范围', () => {
    const old = '开头。\n\n原来的句子。\n\n末尾。';
    const next = '开头。\n\n改写的句子。\n\n末尾。';
    const diff = compareFullText(old, next);
    expect(diff.mode).toBe('sentences');
    expect(diff.oldRanges.map(({ from, to }) => old.slice(from, to).trim())).toEqual(['原来的句子。']);
    expect(diff.newRanges.map(({ from, to }) => next.slice(from, to).trim())).toEqual(['改写的句子。']);
  });
  it('新增、删除、反向和相同正文各有正确结果', () => {
    const added = compareFullText('', '新增句子。');
    expect(added.oldRanges).toEqual([]);
    expect(added.newRanges).toEqual([{ from: 0, to: 5 }]);
    const removed = compareFullText('新增句子。', '');
    expect(removed.oldRanges).toEqual(added.newRanges);
    expect(removed.newRanges).toEqual([]);
    expect(compareFullText('相同。', '相同。').note).toBe('两侧正文完全相同。');
  });
  it('CRLF 与独立 CR 显示规范化后，高亮坐标仍指向最后一行', () => {
    const old = '第一句。\r\n\r\n旧句。\r最后旧句。';
    const next = '第一句。\r\n\r\n新句。\r最后新句。';
    const diff = compareFullText(old, next);
    expect(diff.newRanges.map(({ from, to }) => comparisonDisplayText(next).slice(from, to).trim())).toEqual(['新句。', '最后新句。']);
    expect(diff.newRanges.every((range) => range.to <= comparisonDisplayText(next).length)).toBe(true);
  });
  it('只改空白明确说明，超出句级预算保留完整文本阅读模式', () => {
    expect(compareFullText('同一句。\n\n', '同一句。\n').note).toContain('仅空白');
    const text = 'a'.repeat(SENTENCE_TEXT_LIMIT) + '尾';
    expect(compareFullText(text, 'different').mode).toBe('text');
    expect(compareFullText('甲。'.repeat(2500), '乙。'.repeat(2500)).mode).toBe('text');
  });
});
