import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/** 收集 blockField DecorationSet 的 (from,to,widget) 序列。 */
function collectBlocks(v: EditorView): Array<{ from: number; to: number; widget: unknown }> {
  const set = v.state.field(blockField);
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
