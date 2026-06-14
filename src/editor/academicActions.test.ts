import { describe, expect, it } from 'vitest';
import { formatCitationFor } from './academicActions';

describe('formatCitationFor（ZOT-05 引用↔Typst/LaTeX）', () => {
  it('markdown 原样保留 pandoc', () => {
    expect(formatCitationFor('[@lecun2015]', 'markdown')).toBe('[@lecun2015]');
  });

  it('richtext / 未知语言原样', () => {
    expect(formatCitationFor('[@a; @b]', 'richtext')).toBe('[@a; @b]');
  });

  it('typst 单引用 → #cite(<key>)', () => {
    expect(formatCitationFor('[@lecunDeepLearning2015]', 'typst')).toBe(
      '#cite(<lecunDeepLearning2015>)',
    );
  });

  it('typst 多引用 → 逐个 #cite', () => {
    expect(formatCitationFor('[@a; @b]', 'typst')).toBe('#cite(<a>) #cite(<b>)');
  });

  it('latex 单引用 → \\cite{key}', () => {
    expect(formatCitationFor('[@lecun2015]', 'latex')).toBe('\\cite{lecun2015}');
  });

  it('latex 多引用 → \\cite{a,b}', () => {
    expect(formatCitationFor('[@a; @b]', 'latex')).toBe('\\cite{a,b}');
  });

  it('无 citekey 原样（保险）', () => {
    expect(formatCitationFor('', 'typst')).toBe('');
    expect(formatCitationFor('随便文字', 'latex')).toBe('随便文字');
  });
});
