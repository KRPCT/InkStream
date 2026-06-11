import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';

/**
 * 性能基准测量桩（EDIT-03 性能纪律 / RESEARCH「性能纪律」节）。
 *
 * 建立「10 万字混排文档单次 dispatch 触发的装饰重算 < 16ms（一帧预算）」的测量法与阈值。
 *
 * Wave 0 阶段真实装饰构建函数（inlinePlugin process(view)）尚不存在，故占位实现为
 * 「syntaxTree 一次 visibleRanges 迭代」近似——建立测量骨架与 16ms 阈值。
 *
 * ── Wave 1 接入点 ──────────────────────────────────────────────────────────────
 * inlinePlugin 落地后，把下方 `iterateDecorationsApprox(view)` 占位替换为真实
 * `process(view)`（ViewPlugin 的装饰构建函数，范围收回挂载 view 的 visibleRanges），
 * 其余测量骨架（build100kDoc + performance.now 包裹 + toBeLessThan(16)）原样复用。
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

/**
 * 占位装饰构建近似：迭代 syntaxTree（Wave 1 替换为真实 process(view)）。
 *
 * jsdom 无真实布局，未挂载 view 的 `visibleRanges` 退化为一个估算视口（约首 360 字符），
 * 若仅迭代它则永远只测一小片、与 10 万字无关、阈值形同虚设。故占位阶段迭代「全文树」
 * 以确保测量真正承载 100k 工作量；Wave 1 在挂载的真实 view 上把范围收回 visibleRanges
 * 并调 process(view)，测量骨架（performance.now + toBeLessThan(16)）原样复用。
 */
function iterateDecorationsApprox(view: EditorView): number {
  let count = 0;
  // CM6 增量解析：syntaxTree 仅保证解析到预算前缀；10 万字文档须 ensureSyntaxTree
  // 强制全量解析，迭代才真正承载 100k 工作量（否则只测被解析的几百节点前缀）。
  const tree =
    ensureSyntaxTree(view.state, view.state.doc.length, 5000) ?? syntaxTree(view.state);
  tree.iterate({
    from: 0,
    to: view.state.doc.length,
    enter: () => {
      count += 1;
    },
  });
  return count;
}

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

describe('10 万字装饰重算性能基准（< 16ms 一帧预算）', () => {
  it('单次 dispatch 触发的装饰构建 < 16ms', () => {
    const doc = build100kDoc();
    expect(doc.length).toBeGreaterThanOrEqual(100_000);

    view = makeTestView(doc, [extensionsForLanguage('markdown')]);
    // 预热一次（首迭代含 syntaxTree 惰性构建，避免把解析成本算进帧预算）。
    const warmCount = iterateDecorationsApprox(view);
    // 占位迭代须真正承载 10 万字工作量（否则阈值无意义）。
    expect(warmCount).toBeGreaterThan(1000);

    // 在文档头插入一字，触发一次 dispatch，随后测量装饰重算耗时。
    view.dispatch({ changes: { from: 0, insert: 'x' } });

    const start = performance.now();
    iterateDecorationsApprox(view);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(16);
  });
});
