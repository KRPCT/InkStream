import { describe, expect, it } from 'vitest';
import { codeLanguageFor, markdownCodeLanguages } from './codeLanguages';

/** 代码块嵌套高亮语言表回归门（块编辑增强 W1）。重点：与 blockField 公式块的正交性（math/latex/typst 排除）。 */
describe('codeLanguageFor', () => {
  it('常见语言命中', () => {
    expect(codeLanguageFor('javascript')?.name).toBe('javascript');
    expect(codeLanguageFor('python')?.name).toBe('python');
    expect(codeLanguageFor('rust')?.name).toBe('rust');
    expect(codeLanguageFor('json')?.name).toBe('json');
  });

  it('别名大小写不敏感命中', () => {
    expect(codeLanguageFor('js')?.name).toBe('javascript');
    expect(codeLanguageFor('TS')?.name).toBe('javascript');
    expect(codeLanguageFor('py')?.name).toBe('python');
    expect(codeLanguageFor('rs')?.name).toBe('rust');
    expect(codeLanguageFor('yml')?.name).toBe('yaml');
    expect(codeLanguageFor('bash')?.name).toBe('shell');
    expect(codeLanguageFor('md')?.name).toBe('markdown');
  });

  it('math/latex/typst 显式排除 → null（留给 blockField widget 渲染）', () => {
    expect(codeLanguageFor('math')).toBeNull();
    expect(codeLanguageFor('latex')).toBeNull();
    expect(codeLanguageFor('typst')).toBeNull();
  });

  it('latex 不被 fuzzy 误配到 tex/stex（关键回归：否则抢走 MathJax 渲染）', () => {
    expect(codeLanguageFor('tex')?.name).toBe('tex'); // tex 本身仍命中 stex（LaTeX 源码高亮）
    expect(codeLanguageFor('latex')).toBeNull(); // 但 latex 被排除，不 fuzzy 命中 tex
  });

  it('未装语言优雅降级 null（不崩）', () => {
    expect(codeLanguageFor('cobol')).toBeNull();
  });

  it('表不含 math/latex/typst、含常见语言', () => {
    const names = markdownCodeLanguages().map((d) => d.name);
    expect(names).not.toContain('math');
    expect(names).not.toContain('latex');
    expect(names).not.toContain('typst');
    expect(names).toContain('javascript');
    expect(names).toContain('tex');
  });
});
