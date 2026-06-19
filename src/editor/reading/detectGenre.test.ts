import { describe, expect, it } from 'vitest';
import { detectGenre } from './detectGenre';

describe('detectGenre', () => {
  it('章回 / Chapter 标记 → 小说', () => {
    expect(detectGenre('第一章 风起\n\n他往前走。')).toBe('novel');
    expect(detectGenre('Chapter 1\n\nThe story begins here.')).toBe('novel');
  });

  it('摘要 / 关键词 / 参考文献 → 文献', () => {
    expect(detectGenre('摘要：本文提出……\n关键词：A B\n\n正文\n\n参考文献\n[1] X')).toBe('literature');
  });

  it('对白密度高 → 小说', () => {
    expect(detectGenre('“早。”“嗯。”“走吧。”“好。”'.repeat(30))).toBe('novel');
  });

  it('无明显信号 / 空 → 默认文献', () => {
    expect(detectGenre('just some plain prose without any markers at all here')).toBe('literature');
    expect(detectGenre('')).toBe('literature');
  });
});
