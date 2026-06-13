import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../../types/vault';
import { resolveWikiTarget, wikiTargetPath, wikiTargetToCreatePath } from './wikiTarget';

/** wiki-link target 解析纯逻辑（Phase 4 W3）。 */

const files: FileEntry[] = [
  { name: '中文页.md', path: '笔记/中文页.md' },
  { name: 'english.md', path: 'english.md' },
  { name: 'dup.md', path: 'a/dup.md' },
  { name: 'dup.md', path: 'b/dup.md' },
];

describe('wikiTargetPath（剥 #heading / ^block）', () => {
  it('纯路径不变', () => expect(wikiTargetPath('笔记/中文页')).toBe('笔记/中文页'));
  it('剥 #heading', () => expect(wikiTargetPath('页面#小节')).toBe('页面'));
  it('剥 ^block', () => expect(wikiTargetPath('页面^blk')).toBe('页面'));
  it('剥 #heading^block', () => expect(wikiTargetPath('页面#小节^blk')).toBe('页面'));
  it('去首尾空格', () => expect(wikiTargetPath('  页面 ')).toBe('页面'));
});

describe('resolveWikiTarget', () => {
  it('精确相对路径（补 .md）', () => expect(resolveWikiTarget('笔记/中文页', files)).toBe('笔记/中文页.md'));
  it('裸名匹配（无扩展，Obsidian 风）', () => expect(resolveWikiTarget('english', files)).toBe('english.md'));
  it('裸名匹配中文', () => expect(resolveWikiTarget('中文页', files)).toBe('笔记/中文页.md'));
  it('精确路径优先于裸名（消歧）', () => expect(resolveWikiTarget('b/dup', files)).toBe('b/dup.md'));
  it('解析不到返回 null', () => expect(resolveWikiTarget('不存在', files)).toBeNull());
  it('空返回 null', () => expect(resolveWikiTarget('', files)).toBeNull());
});

describe('wikiTargetToCreatePath（补 .md）', () => {
  it('裸名补 .md', () => expect(wikiTargetToCreatePath('新页')).toBe('新页.md'));
  it('已有 .md 不重复', () => expect(wikiTargetToCreatePath('新页.md')).toBe('新页.md'));
  it('含路径', () => expect(wikiTargetToCreatePath('夹/新页')).toBe('夹/新页.md'));
});
