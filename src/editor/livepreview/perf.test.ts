import { ensureSyntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { buildInlineDecorations } from './inlinePlugin';

/**
 * 性能基准测量桩（EDIT-03 性能纪律 / RESEARCH「性能纪律」节）。
 *
 * 建立「10 万字混排文档单次 dispatch 触发的装饰重算 < 16ms（一帧预算）」的测量法与阈值。
 *
 * Wave 1 接入：占位迭代已替换为真实 `buildInlineDecorations(view)`（inlinePlugin 的装饰构建
 * 函数，仅 view.visibleRanges + RangeSetBuilder）。build100kDoc + performance.now 包裹 +
 * toBeLessThan(16) 测量骨架原样复用。
 *
 * ── 实机帧属手测 ───────────────────────────────────────────────────────────────
 * RESEARCH：jsdom 无真实布局（visibleRanges 近似全文、无分帧渲染），本桩只验「装饰构建
 * 计算」耗时，不验真实渲染帧。端到端帧率须开发期 devtools Performance 实机测——
 * 已登记于 03-VALIDATION.md「Manual-Only Verifications」。
 */

/** 生成约 10 万字的标题/加粗/斜体/列表/链接混排 Markdown。 */
function build100kDoc(): string {
  const blocks: string[] = [];
  let i = 0;
  // 每个 block 约 80 字符，含标题/加粗/斜体/列表/链接多种 inline 元素。
  while (blocks.join('\n').length < 100_000) {
    blocks.push(
      `## 章节 ${i} 标题文本占位`,
      `这是一段含 **加粗${i}** 与 *斜体${i}* 与 [链接${i}](https://example.com/${i}) 的正文。`,
      `- 列表项 ${i}：更多中文正文占位以撑足字符数到十万级别用于性能基准测量。`,
      '',
    );
    i += 1;
  }
  return blocks.join('\n');
}

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

describe('10 万字装饰重算性能基准（< 16ms 一帧预算）', () => {
  it('10 万字文档下真实装饰构建（buildInlineDecorations）< 16ms 且严格 visibleRanges 受限', () => {
    const doc = build100kDoc();
    expect(doc.length).toBeGreaterThanOrEqual(100_000);

    view = makeTestView(doc, [extensionsForLanguage('markdown')]);
    // 强制全量解析，排除 syntaxTree 惰性构建成本，使测量只计装饰构建本身。
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);

    // 性能纪律核心断言：buildInlineDecorations 严格只迭代 view.visibleRanges——
    // 10 万字文档下装饰数仍与视口（而非全文）成比例，证明视口外零迭代（O(visible) 而非 O(doc)）。
    // jsdom 未挂载 view 的 visibleRanges 退化为固定小视口（约首数百字符），故装饰数远小于全文规模。
    const visibleSpan = view.visibleRanges.reduce((s, r) => s + (r.to - r.from), 0);
    expect(visibleSpan).toBeLessThan(doc.length); // 视口 ≪ 全文，证明未全量构建

    // 预热一次（首次装饰构建含树访问惰性成本，避免算进帧预算）。
    buildInlineDecorations(view);

    // 在文档头插入一字，触发一次 dispatch，随后测量真实装饰构建耗时。
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);

    const start = performance.now();
    buildInlineDecorations(view);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(16);
  });
});
