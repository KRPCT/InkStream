import { ensureSyntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { GFM } from '@lezer/markdown';
import { describe, expect, it } from 'vitest';
import { inlineMath } from './inlineMath';

/** 行内 $...$ + 块 $$...$$ 解析回归门（FEAT-INLINE-MATH）。重点：货币/转义/代码 span 三启发式 + 跨行块。 */

function parse(doc: string) {
  const st = EditorState.create({ doc, extensions: [markdown({ extensions: [GFM, inlineMath] })] });
  return ensureSyntaxTree(st, doc.length, 5000);
}
function nodeNames(doc: string): string[] {
  const out: string[] = [];
  parse(doc)?.iterate({ enter: (n) => void out.push(n.name) });
  return out;
}
function firstContent(doc: string, name: string): string | null {
  let r: string | null = null;
  parse(doc)?.iterate({
    enter: (n) => {
      if (r === null && n.name === name) r = doc.slice(n.from, n.to);
    },
  });
  return r;
}

describe('inlineMath 行内 $...$', () => {
  it('$E=mc^2$ → InlineMath + content 取自 InlineMathContent', () => {
    expect(nodeNames('文字 $E=mc^2$ 后')).toContain('InlineMath');
    expect(firstContent('文字 $E=mc^2$ 后', 'InlineMathContent')).toBe('E=mc^2');
  });

  it('货币 $5 / cost $5 and $7 不成公式', () => {
    expect(nodeNames('价格 $5 元')).not.toContain('InlineMath');
    expect(nodeNames('cost $5 and $7')).not.toContain('InlineMath');
  });

  it('行内代码 `$x$` 内的 $ 不成公式（代码 span 先吞）', () => {
    const ns = nodeNames('`$x$`');
    expect(ns).toContain('InlineCode');
    expect(ns).not.toContain('InlineMath');
  });

  it('转义 \\$ 不触发', () => {
    expect(nodeNames('成本 \\$5 元')).not.toContain('InlineMath');
  });

  it('同行两个公式 $a$ $b$ 各自成立', () => {
    const names = nodeNames('$a$ 和 $b$');
    expect(names.filter((n) => n === 'InlineMath')).toHaveLength(2);
  });
});

describe('inlineMath 块 $$...$$', () => {
  it('跨行 $$\\nx^2\\n$$ → BlockMath，content 含换行', () => {
    expect(nodeNames('$$\nx^2\n$$')).toContain('BlockMath');
    expect(firstContent('$$\nx^2\n$$', 'BlockMathContent')).toBe('\nx^2\n');
  });

  it('同行 $$a+b$$ → BlockMath', () => {
    expect(nodeNames('$$a+b$$')).toContain('BlockMath');
    expect(firstContent('$$a+b$$', 'BlockMathContent')).toBe('a+b');
  });

  it('行内 $$ 退让给块解析（不拆成两个空行内公式）', () => {
    // 行首 $$ 走块解析；非行首的 $$ 不被行内当作两个空 $
    expect(nodeNames('$$\na\n$$').filter((n) => n === 'InlineMath')).toHaveLength(0);
  });
});
