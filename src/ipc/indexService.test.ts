import { describe, expect, it } from 'vitest';
import { indexDbUrl, isIndexable } from './indexService';

/** 索引库连接串构造（Phase 4 W4 修：剥 Windows \\?\ 扩展前缀，反链恒空真因回归门）。 */
describe('indexDbUrl', () => {
  it('剥除 Windows 扩展长度前缀 \\\\?\\（真机 vault 根的真实形态）', () => {
    expect(indexDbUrl('\\\\?\\D:\\InkStreamTestVault')).toBe(
      'sqlite:D:/InkStreamTestVault/.inkstream/index.db',
    );
  });

  it('剥除 UNC 扩展前缀 \\\\?\\UNC\\ 还原为 \\\\', () => {
    expect(indexDbUrl('\\\\?\\UNC\\server\\share\\vault')).toBe(
      'sqlite://server/share/vault/.inkstream/index.db',
    );
  });

  it('普通 Windows 路径：仅反斜杠归一', () => {
    expect(indexDbUrl('D:\\vault')).toBe('sqlite:D:/vault/.inkstream/index.db');
  });

  it('已是正斜杠（POSIX）原样', () => {
    expect(indexDbUrl('/home/u/vault')).toBe('sqlite:/home/u/vault/.inkstream/index.db');
  });
});

describe('isIndexable', () => {
  it('仅 .md 进索引', () => {
    expect(isIndexable('a/b.md')).toBe(true);
    expect(isIndexable('a/b.txt')).toBe(false);
    expect(isIndexable('a/b.markdown')).toBe(false);
  });
});
