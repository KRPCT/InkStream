import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, dispatchComposition, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { composingGuard } from './composingGuard';
import { blockField, tableAtomicRanges } from './blockField';
import { TableWidget } from './widgets/TableWidget';

/**
 * 块级层 StateField 回归门（RESEARCH Pattern 2 + 4 / Pitfall 3 / D-06）。
 *
 * 断言：
 *   1. 含 GFM 表格 doc 构建后 blockField 持的 DecorationSet 含 block widget（TableWidget）；
 *   2. 光标移入表格 range 内后该表不再被替换（整块还原源码，D-06）；
 *   3. tableAtomicRanges 覆盖表格 range（键盘光标移动跳过 widget，Pattern 4）；
 *   4. IME 短路：compositionstart 后 docChanged 不重建块级 deco（保旧 RangeSet）；
 *   5. 源纪律：provide 调 EditorView.decorations.from + block:true + atomicRanges + isFrozen/composing 短路。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

const TABLE_DOC = [
  '正文一',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '正文二',
].join('\n');

/** 表格块在 doc 中的起止（第三行 `| a | b |` 起，到 `| 1 | 2 |` 行末）。 */
const TABLE_FROM = TABLE_DOC.indexOf('| a | b |');
const TABLE_TO = TABLE_DOC.indexOf('| 1 | 2 |') + '| 1 | 2 |'.length;

/** 用 markdown(GFM) + blockField 构建 view，光标默认放在 doc 起点（表格外）。 */
function bfView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), blockField, composingGuard]);
}

/** 收集 blockField 替换 DecorationSet 的 (from,to,widget) 序列。 */
function collectBlocks(v: EditorView): Array<{ from: number; to: number; widget: unknown }> {
  const set = v.state.field(blockField).deco;
  const out: Array<{ from: number; to: number; widget: unknown }> = [];
  const iter = set.iter();
  while (iter.value) {
    out.push({
      from: iter.from,
      to: iter.to,
      widget: (iter.value.spec as { widget?: unknown }).widget,
    });
    iter.next();
  }
  return out;
}

describe('blockField 块级替换', () => {
  it('含表格 doc 构建后 DecorationSet 含 TableWidget block 装饰', () => {
    view = bfView(TABLE_DOC);
    // 光标在 doc 起点（表格外）：表格被替换为 widget。
    view.dispatch({ selection: EditorSelection.cursor(0) });

    const blocks = collectBlocks(view);
    const tableBlock = blocks.find((b) => b.widget instanceof TableWidget);
    expect(tableBlock).toBeDefined();
    expect(tableBlock!.from).toBe(TABLE_FROM);
    expect(tableBlock!.to).toBe(TABLE_TO);
  });

  it('光标移入表格 range 后该表不被替换（整块还原 D-06）', () => {
    view = bfView(TABLE_DOC);
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(collectBlocks(view).some((b) => b.widget instanceof TableWidget)).toBe(true);

    // 光标移入表格内（任一单元格位置）：整块还原，不再有 TableWidget 替换。
    view.dispatch({ selection: EditorSelection.cursor(TABLE_FROM + 3) });
    expect(collectBlocks(view).some((b) => b.widget instanceof TableWidget)).toBe(false);
  });

  it('doc 不变（块级替换仅装饰，绝不改真相源）', () => {
    view = bfView(TABLE_DOC);
    expect(view.state.doc.toString()).toBe(TABLE_DOC);
  });
});

describe('blockField 选区移动复用（UAT #8 性能根因）', () => {
  it('普通选区移动（未跨表格边界）原样复用 BlockState，不重建（无 O(doc) 全树重算）', () => {
    view = bfView(TABLE_DOC);
    view.dispatch({ selection: EditorSelection.cursor(0) });
    const before = view.state.field(blockField);

    // 光标在表格外的两点间移动（始终不在任何表格内）：边界未跨越 → 引用不变。
    view.dispatch({ selection: EditorSelection.cursor(1) });
    expect(view.state.field(blockField)).toBe(before);

    view.dispatch({ selection: EditorSelection.cursor(2) });
    expect(view.state.field(blockField)).toBe(before);
  });

  it('表格内部移动（始终在同一表格块）原样复用 BlockState，不重建', () => {
    view = bfView(TABLE_DOC);
    // 先把光标移入表格内（一次跨越 → 重建为整块还原态）。
    view.dispatch({ selection: EditorSelection.cursor(TABLE_FROM + 1) });
    const revealed = view.state.field(blockField);
    expect(revealed.deco.size).toBe(0); // 表格还原源码，无替换装饰。

    // 在表格内部相邻单元格间移动：仍在同一块 → 不重建。
    view.dispatch({ selection: EditorSelection.cursor(TABLE_FROM + 5) });
    expect(view.state.field(blockField)).toBe(revealed);
  });

  it('光标跨入表格边界时重建（D-06 整块还原切换：进块 → 还原源码）', () => {
    view = bfView(TABLE_DOC);
    view.dispatch({ selection: EditorSelection.cursor(0) });
    const outside = view.state.field(blockField);
    expect(outside.deco.size).toBeGreaterThan(0); // 表格外：被替换为 widget。

    // 跨入表格 → 重建（新引用），整块还原（无替换装饰）。
    view.dispatch({ selection: EditorSelection.cursor(TABLE_FROM + 3) });
    const inside = view.state.field(blockField);
    expect(inside).not.toBe(outside);
    expect(inside.deco.size).toBe(0);
  });

  it('光标移出表格边界时重建（D-06：出块 → 重渲染 widget）', () => {
    view = bfView(TABLE_DOC);
    view.dispatch({ selection: EditorSelection.cursor(TABLE_FROM + 3) });
    expect(view.state.field(blockField).deco.size).toBe(0);

    // 跨出表格 → 重建，表格重新渲染为 widget。
    view.dispatch({ selection: EditorSelection.cursor(0) });
    const out = view.state.field(blockField);
    expect(out.deco.size).toBeGreaterThan(0);
    expect(collectBlocks(view).some((b) => b.widget instanceof TableWidget)).toBe(true);
  });
});

describe('blockField 选区移动性能基准（10 万字含表格，< 16ms 一帧预算）', () => {
  /** 生成约 10 万字正文，中部嵌一张 GFM 表格。 */
  function build100kDocWithTable(): { doc: string; tableFrom: number } {
    const head: string[] = [];
    let i = 0;
    while (head.join('\n').length < 50_000) {
      head.push(`## 章节 ${i}`, `含 **加粗${i}** 与 *斜体${i}* 的正文占位以撑足字符数。`, '');
      i += 1;
    }
    const table = ['| a | b |', '| - | - |', '| 1 | 2 |'];
    const tail: string[] = [];
    while (tail.join('\n').length < 50_000) {
      tail.push(`### 小节 ${i}`, `更多中文正文占位用于性能基准测量段落 ${i}。`, '');
      i += 1;
    }
    const headStr = head.join('\n');
    const doc = [headStr, '', table.join('\n'), '', tail.join('\n')].join('\n');
    return { doc, tableFrom: doc.indexOf('| a | b |') };
  }

  it('表格外大量纯选区移动每次 dispatch < 16ms（不触发 O(doc) 全树重建）', () => {
    const { doc } = build100kDocWithTable();
    expect(doc.length).toBeGreaterThanOrEqual(100_000);

    view = bfView(doc);
    // 强制全量解析，排除惰性建树成本，使测量只计 update 路径本身。
    ensureSyntaxTree(view.state, view.state.doc.length, 5000);
    view.dispatch({ selection: EditorSelection.cursor(0) });

    const before = view.state.field(blockField);
    let worst = 0;
    // 在文档头部连续移动光标（始终在表格外，绝不跨越表格边界）。
    for (let pos = 1; pos <= 200; pos += 1) {
      const start = performance.now();
      view.dispatch({ selection: EditorSelection.cursor(pos) });
      worst = Math.max(worst, performance.now() - start);
    }

    // 性能纪律：每次纯选区移动远低于一帧预算（无全文语法树访问）。
    expect(worst).toBeLessThan(16);
    // 复用证明：200 次非边界移动后仍是同一 BlockState 引用（零重建）。
    expect(view.state.field(blockField)).toBe(before);
  });
});

describe('blockField atomicRanges（Pattern 4）', () => {
  it('tableAtomicRanges 覆盖表格 range（光标外时）', () => {
    view = makeTestView(TABLE_DOC, [
      extensionsForLanguage('markdown'),
      blockField,
      tableAtomicRanges,
      composingGuard,
    ]);
    view.dispatch({ selection: EditorSelection.cursor(0) });

    // 经 atomicRanges facet 读出的 RangeSet 覆盖表格 [from,to]。
    const ranges = view.state.facet(EditorView.atomicRanges).map((fn) => fn(view!));
    let covered = false;
    for (const set of ranges) {
      const iter = set.iter();
      while (iter.value) {
        if (iter.from === TABLE_FROM && iter.to === TABLE_TO) covered = true;
        iter.next();
      }
    }
    expect(covered).toBe(true);
  });
});

describe('blockField IME 短路', () => {
  it('compositionstart 后一次 docChanged 不重建块级 deco（保旧 RangeSet）', () => {
    view = bfView(TABLE_DOC);
    view.dispatch({ selection: EditorSelection.cursor(0) });
    const before = view.state.field(blockField);

    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    // 组合期在表格外插入一字：blockField update 短路 → DecorationSet 引用不变。
    view.dispatch({ changes: { from: 0, insert: '你' } });

    expect(view.state.field(blockField)).toBe(before);
  });
});

describe('blockField 源纪律', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/editor/livepreview/blockField.ts'),
    'utf8',
  );

  it('provide 经 EditorView.decorations.from（块级必从 StateField，Pitfall 3）', () => {
    expect(src).toMatch(/provide/);
    expect(src).toContain('EditorView.decorations.from');
  });

  it('Decoration.replace 含 block:true', () => {
    expect(src).toMatch(/block:\s*true/);
  });

  it('含 EditorView.atomicRanges', () => {
    expect(src).toContain('EditorView.atomicRanges');
  });

  it('update 含 isFrozen/composing 短路', () => {
    expect(src).toMatch(/isFrozen|composing/);
  });
});
