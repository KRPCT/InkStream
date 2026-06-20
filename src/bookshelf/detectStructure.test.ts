import { describe, expect, it } from 'vitest';
import { detectStructure } from './detectStructure';
import type { DirTreeEntry } from '../types/bookshelf';

const dir = (name: string, children: DirTreeEntry[]): DirTreeEntry => ({
  name,
  path: `/books/${name}`,
  isDir: true,
  children,
});
const file = (name: string): DirTreeEntry => ({ name, path: `/books/${name}`, isDir: false, children: [] });

describe('detectStructure', () => {
  it('全是文件 → 单卷书（自然序，第2章 < 第10章）', () => {
    const tree = dir('某书', [file('第10章.txt'), file('第2章.txt'), file('第1章.txt')]);
    const vols = detectStructure(tree, '某书');
    expect(vols).toHaveLength(1);
    expect(vols[0].title).toBe('某书');
    expect(vols[0].chapters.map((c) => c.title)).toEqual(['第1章', '第2章', '第10章']);
  });

  it('子目录 → 卷，其下文件 → 章', () => {
    const tree = dir('长篇', [
      dir('第二卷', [file('c.epub')]),
      dir('第一卷', [file('a.epub'), file('b.epub')]),
    ]);
    const vols = detectStructure(tree, '长篇');
    expect(vols.map((v) => v.title)).toEqual(['第一卷', '第二卷']);
    expect(vols[0].chapters.map((c) => c.title)).toEqual(['a', 'b']);
  });

  it('根下松散文件与卷子目录并存 → 松散归入「正文」前置卷', () => {
    const tree = dir('混合', [file('序.txt'), dir('正文卷', [file('1.txt')])]);
    const vols = detectStructure(tree, '混合');
    expect(vols.map((v) => v.title)).toEqual(['正文', '正文卷']);
    expect(vols[0].chapters.map((c) => c.title)).toEqual(['序']);
  });

  it('非书籍格式被排除（detectStructure 仅收 txt/docx/epub/pdf）', () => {
    const tree = dir('书', [file('readme.md'), file('正文.txt')]);
    const vols = detectStructure(tree, '书');
    expect(vols[0].chapters.map((c) => c.title)).toEqual(['正文']);
  });
});
