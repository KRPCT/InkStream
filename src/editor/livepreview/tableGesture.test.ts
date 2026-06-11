import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { composingGuard } from './composingGuard';
import { blockField } from './blockField';
import { handleTableMousedown } from './tableGesture';
import { TableWidget } from './widgets/TableWidget';

/**
 * 表格点击穿透手势回归门（UAT #1 / D-06 整块还原 / Pattern 4 programmatic-selection）。
 *
 * 断言：
 *   1. 点击落在表格块内 → preventDefault + 程序化 dispatch 光标进 [from+1, to] + return true，
 *      且随后该表不再被替换（buildBlockState 跳过 → 整块还原源码，立即可编辑）；
 *   2. 非表格点击 → 不改选区且 return false（交回 CM 默认）；
 *   3. posAtCoords 未命中（null）→ return false；
 *   4. 源纪律：程序化 EditorSelection.cursor dispatch + 经 blockField.tables 判定 + preventDefault。
 *
 * jsdom 无布局：posAtCoords 经 Object.defineProperty 钉死返回值（同 linkGesture.test.ts 套路）。
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

const TABLE_FROM = TABLE_DOC.indexOf('| a | b |');
const TABLE_TO = TABLE_DOC.indexOf('| 1 | 2 |') + '| 1 | 2 |'.length;

/** 用 markdown(GFM) + blockField 构建 view，光标默认在 doc 起点（表格外，表格被替换为 widget）。 */
function tgView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), blockField, composingGuard]);
}

/** 钉死 posAtCoords 返回值（jsdom 无布局）。 */
function pinPosAtCoords(v: EditorView, pos: number | null): void {
  Object.defineProperty(v, 'posAtCoords', { configurable: true, value: () => pos });
}

/** 当前 blockField 是否仍把表格替换为 TableWidget。 */
function tableStillReplaced(v: EditorView): boolean {
  const set = v.state.field(blockField).deco;
  const iter = set.iter();
  while (iter.value) {
    if ((iter.value.spec as { widget?: unknown }).widget instanceof TableWidget) return true;
    iter.next();
  }
  return false;
}

function clickEvent(): { event: MouseEvent; prevented: () => boolean } {
  let prevented = false;
  const event = {
    clientX: 0,
    clientY: 0,
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as MouseEvent;
  return { event, prevented: () => prevented };
}

describe('handleTableMousedown 点击穿透（UAT #1）', () => {
  it('点击表格块 → preventDefault + 光标进块 [from+1,to] + return true + 整块还原源码', () => {
    view = tgView(TABLE_DOC);
    view.dispatch({ selection: EditorSelection.cursor(0) });
    // 前置：光标在表格外，表格被替换为 widget。
    expect(tableStillReplaced(view)).toBe(true);

    // block-replace widget 的 posAtCoords 只会给 block.from——模拟点击命中表格上边界。
    pinPosAtCoords(view, TABLE_FROM);
    const { event, prevented } = clickEvent();

    const handled = handleTableMousedown(event, view);

    expect(handled).toBe(true);
    expect(prevented()).toBe(true);

    // 光标落进表格块内（≥ from+1，≤ to）。
    const head = view.state.selection.main.head;
    expect(head).toBeGreaterThanOrEqual(TABLE_FROM + 1);
    expect(head).toBeLessThanOrEqual(TABLE_TO);

    // 整块还原：表格不再被替换为 widget（buildBlockState 跳过 → 源码可编辑 D-06）。
    expect(tableStillReplaced(view)).toBe(false);
  });

  it('点击表格内部位置（posAtCoords 给块内 pos）→ 光标落该位、整块还原', () => {
    view = tgView(TABLE_DOC);
    view.dispatch({ selection: EditorSelection.cursor(0) });

    const inside = TABLE_FROM + 5;
    pinPosAtCoords(view, inside);
    const { event } = clickEvent();

    expect(handleTableMousedown(event, view)).toBe(true);
    expect(view.state.selection.main.head).toBe(inside);
    expect(tableStillReplaced(view)).toBe(false);
  });

  it('非表格点击 → 不改选区且 return false（交回 CM 默认置光标）', () => {
    view = tgView(TABLE_DOC);
    view.dispatch({ selection: EditorSelection.cursor(0) });

    // 命中表格外（doc 起点正文）。
    pinPosAtCoords(view, 0);
    const { event, prevented } = clickEvent();

    expect(handleTableMousedown(event, view)).toBe(false);
    expect(prevented()).toBe(false);
    // 选区未被本手势改动（仍在 0）。
    expect(view.state.selection.main.head).toBe(0);
    // 表格仍被替换（未被劫持还原）。
    expect(tableStillReplaced(view)).toBe(true);
  });

  it('posAtCoords 返回 null（坐标未命中文档）→ return false', () => {
    view = tgView(TABLE_DOC);
    pinPosAtCoords(view, null);
    const { event } = clickEvent();

    expect(handleTableMousedown(event, view)).toBe(false);
  });
});

describe('tableGesture 源纪律', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/editor/livepreview/tableGesture.ts'),
    'utf8',
  );

  it('程序化 EditorSelection.cursor dispatch（不靠 CM 默认 select，Pattern 4 例外）', () => {
    expect(src).toContain('EditorSelection.cursor');
    expect(src).toContain('view.dispatch');
  });

  it('经 blockField.tables 判定命中 + preventDefault 接管置光标', () => {
    expect(src).toContain('blockField');
    expect(src).toContain('tables');
    expect(src).toContain('preventDefault');
  });

  it('导出 tableGesture（domEventHandlers 扩展）', () => {
    expect(src).toMatch(/export const tableGesture/);
    expect(src).toContain('domEventHandlers');
  });
});
