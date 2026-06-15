import { describe, expect, it } from 'vitest';
import { countWords } from './wordCount';

describe('countWords（中英混合单一真相源）', () => {
  it('空串 / 纯空白 / 纯标点 → 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
    expect(countWords('，。、；！？…—')).toBe(0);
  });

  it('拉丁词：按词计，标点不计', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('a, b. c!')).toBe(3);
    expect(countWords("don't")).toBe(1); // 缩写算一个词
  });

  it('CJK：每字算一词', () => {
    expect(countWords('你好世界')).toBe(4);
    expect(countWords('世界')).toBe(2);
  });

  it('中英混合：CJK 每字 + 拉丁词各计', () => {
    expect(countWords('hello 世界')).toBe(3); // hello + 世 + 界
    expect(countWords('用 CodeMirror 写作')).toBe(4); // 用 + CodeMirror + 写 + 作
  });

  it('数字段算一个词', () => {
    expect(countWords('123 abc')).toBe(2);
  });
});
