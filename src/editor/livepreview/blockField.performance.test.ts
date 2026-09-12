import { stdout, threadCpuUsage } from 'node:process';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { blockField } from './blockField';
import { tableEditState } from './tableEditState';
import { refreshLivePreview } from '../composition';

let view: EditorView | null = null;
afterEach(() => { destroyTestView(view); view = null; });
function bfView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), tableEditState, blockField]);
}

describe('blockField 选区移动性能基准（10 万字含表格，< 16ms 一帧预算）', () => {
  /** 生成约 10 万字正文，中部嵌一张 GFM 表格。 */
  function build100kDocWithTable(): { doc: string; tableFrom: number } {
    const head: string[] = [];
    let headLength = 0;
    let i = 0;
    while (headLength < 50_000) {
      const heading = `## 章节 ${i}`;
      const paragraph = `含 **加粗${i}** 与 *斜体${i}* 的正文占位以撑足字符数。`;
      head.push(heading, paragraph, '');
      headLength += heading.length + paragraph.length + 3;
      i += 1;
    }
    const table = ['| a | b |', '| - | - |', '| 1 | 2 |'];
    const tail: string[] = [];
    let tailLength = 0;
    while (tailLength < 50_000) {
      const heading = `### 小节 ${i}`;
      const paragraph = `更多中文正文占位用于性能基准测量段落 ${i}。`;
      tail.push(heading, paragraph, '');
      tailLength += heading.length + paragraph.length + 3;
      i += 1;
    }
    const headStr = head.join('\n');
    const doc = [headStr, '', table.join('\n'), '', tail.join('\n')].join('\n');
    return { doc, tableFrom: doc.indexOf('| a | b |') };
  }

  it('表格外大量纯选区移动每次 dispatch < 16ms（不触发 O(doc) 全树重建）', () => {
    const { doc, tableFrom } = build100kDocWithTable();
    expect(doc.length).toBeGreaterThanOrEqual(100_000);

    view = bfView(doc);
    // 强制全量解析，排除惰性建树成本，使测量只计 update 路径本身。
    expect(ensureSyntaxTree(view.state, view.state.doc.length, 5000)).not.toBeNull();
    view.dispatch({ selection: EditorSelection.cursor(0), effects: refreshLivePreview.of(null) });

    const before = view.state.field(blockField);
    expect(before.tables).toHaveLength(1);
    expect(before.tables[0].from).toBe(tableFrom);
    expect(before.deco.size).toBeGreaterThan(0);
    // Measure the warmed update path, after parser/JIT setup and fixture garbage collection.
    // CI runs this file in a fresh fork with --expose-gc, outside the ordinary suite's heap.
    for (let pos = 1; pos <= 200; pos += 1) view.dispatch({ selection: EditorSelection.cursor(pos) });
    view.dispatch({ selection: EditorSelection.cursor(0) });
    globalThis.gc?.();
    expect(view.state.field(blockField)).toBe(before);
    let worst = 0;
    let worstCpu = 0;
    // 在文档头部连续移动光标（始终在表格外，绝不跨越表格边界）。
    for (let pos = 1; pos <= 200; pos += 1) {
      const cpuStart = threadCpuUsage();
      const start = performance.now();
      view.dispatch({ selection: EditorSelection.cursor(pos) });
      worst = Math.max(worst, performance.now() - start);
      const cpu = threadCpuUsage(cpuStart);
      worstCpu = Math.max(worstCpu, (cpu.user + cpu.system) / 1000);
    }

    stdout.write(`blockField selection benchmark ${JSON.stringify({ worstWallMs: worst, worstThreadCpuMs: worstCpu, gcAvailable: typeof globalThis.gc === 'function' })}\n`);
    // The reuse assertion runs even if the subsequent wall-clock assertion fails.
    expect(view.state.field(blockField)).toBe(before);
    // 性能纪律：每次纯选区移动远低于一帧预算（无全文语法树访问）。
    expect(worst).toBeLessThan(16);
  });
});
