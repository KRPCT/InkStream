import { describe, expect, it } from 'vitest';
import { findMatchOffset } from './fileOpenFlow';

/** 全文搜索 `#` 选中后在「当前文档真相源」上自校准定位（索引可能滞后，复用续读锚点纪律）。 */
describe('findMatchOffset', () => {
  it('大小写不敏感定位首个出现（对齐 trigram case_sensitive 0）', () => {
    expect(findMatchOffset('Hello World hello', 'WORLD')).toBe(6);
    expect(findMatchOffset('foo Bar baz', 'bar')).toBe(4);
  });

  it('中文按字符定位', () => {
    expect(findMatchOffset('前言：研究方法与数据', '研究方法')).toBe(3);
  });

  it('未命中（索引陈旧 / 词已删）返 -1', () => {
    expect(findMatchOffset('abc', 'xyz')).toBe(-1);
  });

  it('空词 / 纯空白返 -1', () => {
    expect(findMatchOffset('abc', '')).toBe(-1);
    expect(findMatchOffset('abc', '   ')).toBe(-1);
  });
});
