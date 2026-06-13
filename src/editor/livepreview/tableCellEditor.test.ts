import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { destroyTestView, dispatchComposition, makeTestView } from '../../test/composition';
import { __resetCompositionForTest, compositionGate } from '../composition';
import { extensionsForLanguage } from '../languages';
import { blockField } from './blockField';
import { setTableEdit, tableEditState } from './tableEditState';
import { tableModelAt } from './tableModel';
import {
  destroyActive,
  getActiveCellEditor,
  mountCell,
  setPendingClick,
} from './tableCellEditor';

/**
 * 方案 B 嵌套子 EditorView 管理层回归门（TABLE-REDESIGN §3 / CDP 自验 a-f）。
 *
 * 断言：
 *   1. 挂载/复用/销毁：mountCell 幂等复用同一实例（保 caret/组合存活）；切格销毁旧建新；destroyActive 配对；
 *   2. 子→主同步：子编辑器输入英文 → 单点 dispatch 写回主 doc 对应 cell 区间，合法 GFM；
 *   3. 转义：含 `|` 输入被 escapePipes 转 `\|`（不破坏列结构）；
 *   4. 组合期门：组合中子→主不 commit（排队），解除后落 doc（中文）；
 *   5. 删字符不删格：子 doc 内删字符是子编辑器原生删字符，绝不动主表结构（cell 数/列数不变）；
 *   6. 导航：Tab 切换激活 cellIndex；方向键到边界跨格；末格 Tab 追加行；
 *   7. 点击定位：setPendingClick 后挂载，caret 落点击处（posAtCoords，jsdom 退化到末尾亦可接受）。
 */

let view: EditorView | null = null;

afterEach(() => {
  if (view) destroyActive(view);
  destroyTestView(view);
  view = null;
});

const DOC = ['| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');

/** 真实主 view（markdown + 冻结门 + blockField + tableEditState），挂进 jsdom 以便子编辑器测量。 */
function mainView(doc: string): EditorView {
  const v = makeTestView(doc, [
    compositionGate,
    extensionsForLanguage('markdown'),
    tableEditState,
    blockField,
  ]);
  document.body.appendChild(v.dom);
  return v;
}

/** 给 cellIndex 造一个挂载用的 td 并 mountCell（模拟 armCells），返回子 view。 */
function mount(v: EditorView, cellIndex: number): EditorView {
  v.dispatch({ effects: setTableEdit.of({ tableFrom: 0, cellIndex }) });
  const cell = document.createElement('td');
  document.body.appendChild(cell);
  mountCell(v, cell, 0, cellIndex);
  return getActiveCellEditor(v)!.sub;
}

describe('mountCell 挂载 / 复用 / 销毁', () => {
  it('同 tableFrom+cellIndex 再挂载 → 复用同一子编辑器实例（保 caret/组合存活）', () => {
    view = mainView(DOC);
    const first = mount(view, 2);
    const cell2 = document.createElement('td');
    document.body.appendChild(cell2);
    mountCell(view, cell2, 0, 2); // 同格再挂载。
    expect(getActiveCellEditor(view)!.sub).toBe(first); // 同一实例。
  });

  it('切到别格 → 销毁旧、建新（同时只一个活动子编辑器）', () => {
    view = mainView(DOC);
    const first = mount(view, 2);
    const next = mount(view, 3);
    expect(next).not.toBe(first);
    expect(getActiveCellEditor(view)!.cellIndex).toBe(3);
  });

  it('destroyActive → 子编辑器销毁、WeakMap 清空', () => {
    view = mainView(DOC);
    mount(view, 2);
    destroyActive(view);
    expect(getActiveCellEditor(view)).toBeNull();
  });

  it('子 doc 初值 = 该 cell 当前源文本（去填充空格）', () => {
    view = mainView(DOC);
    const sub = mount(view, 2); // 首个数据格 "1"。
    expect(sub.state.doc.toString()).toBe('1');
  });
});

describe('子→主同步（CDP 自验 c）', () => {
  it('子编辑器输入英文 → 单点 dispatch 写回主 doc cell 区间，合法 GFM', () => {
    view = mainView(DOC);
    const sub = mount(view, 2);
    sub.dispatch({ changes: { from: 0, to: sub.state.doc.length, insert: 'hello' } });
    expect(view.state.doc.toString()).toContain('hello');
    const model = tableModelAt(view.state, 0)!;
    expect(model.columns).toBe(2);
    expect(model.cells.length).toBe(6); // 结构不变（表头 2 + 两数据行各 2）。
  });

  it('含 | 的输入被转义为 \\|（不破坏列结构）', () => {
    view = mainView(DOC);
    const sub = mount(view, 2);
    sub.dispatch({ changes: { from: 0, to: sub.state.doc.length, insert: 'a|b' } });
    expect(view.state.doc.toString()).toContain('a\\|b');
    expect(tableModelAt(view.state, 0)!.columns).toBe(2);
  });

  it('子内容与主 doc 现值等价 → 不产生空事务', () => {
    view = mainView(DOC);
    const sub = mount(view, 2);
    const before = view.state.doc.toString();
    // 重打一遍同值（先清后写 "1"）：归一化后与源等价，跳过 dispatch。
    sub.dispatch({ changes: { from: 0, to: sub.state.doc.length, insert: '1' } });
    expect(view.state.doc.toString()).toBe(before);
  });
});

describe('组合期门（CDP 自验 e）', () => {
  it('组合中子→主不 commit；compositionend drain 后落 doc（中文）', async () => {
    view = mainView(DOC);
    const sub = mount(view, 2);
    const before = view.state.doc.toString();

    // 组合开始（主门冻结）：子→主同步在组合期排队，绝不 dispatch 主 doc。
    dispatchComposition(view, { phase: 'compositionstart', data: '中' });
    sub.dispatch({ changes: { from: 0, to: sub.state.doc.length, insert: '中文' } });
    expect(view.state.doc.toString()).toBe(before); // 组合期主 doc 未变（已排队）。

    // 组合结束：门解冻 + 微任务 drain → 排队的子→主 commit 执行。
    dispatchComposition(view, { phase: 'compositionend', data: '中文' });
    await Promise.resolve(); // 等门的 drain 微任务。
    await Promise.resolve(); // commitSub 内可能再排一层微任务，多等一拍。
    expect(view.state.doc.toString()).toContain('中文');
    __resetCompositionForTest(view);
  });
});

describe('删字符不删格（CDP 自验 d / §5.2）', () => {
  it('子 doc 内删空 → 主表结构不变（cell 数/列数不变，绝不删格）', () => {
    view = mainView(DOC);
    const sub = mount(view, 2); // "1"。
    sub.dispatch({ changes: { from: 0, to: sub.state.doc.length, insert: '' } }); // 删空该格。
    const model = tableModelAt(view.state, 0)!;
    expect(model.cells.length).toBe(6); // 结构不变（格还在，只是空）。
    expect(model.columns).toBe(2);
    expect(sub.state.doc.length).toBe(0); // 子 doc 空。
  });
});

describe('跨格导航（CDP 自验 f / §6）', () => {
  it('Tab → 激活态推进到下一格（cellIndex+1）', () => {
    view = mainView(DOC);
    const sub = mount(view, 2);
    runKey(sub, 'Tab');
    expect(view.state.field(tableEditState)!.cellIndex).toBe(3);
  });

  it('Shift+Tab 在首格 → 退出编辑态（光标回表前）', () => {
    view = mainView(DOC);
    const sub = mount(view, 0);
    runKey(sub, 'Shift-Tab');
    expect(view.state.field(tableEditState)).toBeNull();
  });

  it('末格 Tab → 追加新行并落新行首列', () => {
    view = mainView(DOC);
    const model = tableModelAt(view.state, 0)!;
    const last = model.cells.length - 1;
    const sub = mount(view, last);
    runKey(sub, 'Tab');
    const after = tableModelAt(view.state, 0)!;
    expect(after.cells.length).toBe(8); // 原 6 + 新行 2。
    expect(view.state.field(tableEditState)!.cellIndex).toBe(6); // 新行首列。
  });

  it('ArrowRight 在子 doc 末尾 → 跨格；非边界不跨', () => {
    view = mainView(DOC);
    const sub = mount(view, 2); // "1"，长度 1。
    sub.dispatch({ selection: EditorSelection.cursor(0) }); // caret 在格首（非末尾）。
    runKey(sub, 'ArrowRight');
    expect(view.state.field(tableEditState)!.cellIndex).toBe(2); // 非边界：不跨格。
    sub.dispatch({ selection: EditorSelection.cursor(sub.state.doc.length) }); // caret 末尾。
    runKey(sub, 'ArrowRight');
    expect(view.state.field(tableEditState)!.cellIndex).toBe(3); // 边界：跨到下一格。
  });
});

describe('点击定位（CDP 自验 a）', () => {
  it('setPendingClick 后挂载 → 不报错且子编辑器在册（坐标定位走 posAtCoords）', () => {
    view = mainView(DOC);
    setPendingClick(0, 0);
    const sub = mount(view, 2);
    expect(getActiveCellEditor(view)!.sub).toBe(sub);
    // jsdom 无真实布局，posAtCoords 多半返回 null → 回落末尾；不崩即达链路验证目的。
    expect(sub.state.selection.main.head).toBeGreaterThanOrEqual(0);
  });
});

describe('撤销本地优先（B2 修复：子内 Ctrl+Z 先撤子、不跳主/不跳顶）', () => {
  it('子内编辑后 Ctrl+Z → 撤销子 doc 并经 commit 回写主（本地优先，不回落主 undo）', () => {
    view = mainView(DOC);
    const sub = mount(view, 2); // "1"
    sub.dispatch({ changes: { from: sub.state.doc.length, insert: 'X' } }); // "1X"
    expect(sub.state.doc.toString()).toBe('1X');
    expect(view.state.doc.toString()).toContain('1X'); // 已 commit 到主 doc。
    runMod(sub, 'z'); // Ctrl+Z：子有可撤 → undo(sub) 先生效，不委派主。
    expect(sub.state.doc.toString()).toBe('1'); // 子 undo 撤回。
    expect(view.state.doc.toString()).not.toContain('1X'); // 主 doc 经 commit 同步回 "1"。
    expect(view.state.doc.toString()).toContain('| 1 |');
  });
});

describe('活动格跟随列对齐（A：编辑居中/右列时子编辑器文字也对齐）', () => {
  it('居中列活动子编辑器 text-align=center；普通(none)列=left', () => {
    const doc = ['| a | b |', '| --- | :---: |', '| 1 | 2 |'].join('\n'); // 列1 居中、列0 none。
    view = mainView(doc);
    const subCenter = mount(view, 3); // 数据格 idx3 = 列1（居中）。
    expect(subCenter.dom.style.textAlign).toBe('center');
    const subLeft = mount(view, 2); // 数据格 idx2 = 列0（none→左）。
    expect(subLeft.dom.style.textAlign).toBe('left');
  });
});

describe('进格锚主选区（B2 修复：主选区移入表内，回落主 undo 不跳文档顶）', () => {
  it('表格非文首时进格 → 微任务后主选区落入表格区间（修主选区停 pos 0 致 undo 跳顶）', async () => {
    const doc = ['前言一段', '', '| a | b |', '| - | - |', '| 1 | 2 |'].join('\n');
    view = mainView(doc);
    const model = tableModelAt(view.state, doc.indexOf('|'))!;
    expect(view.state.selection.main.head).toBe(0); // 初始主选区在文首（表外）。
    const cell = document.createElement('td');
    document.body.appendChild(cell);
    view.dispatch({ effects: setTableEdit.of({ tableFrom: model.tableFrom, cellIndex: 2 }) });
    mountCell(view, cell, model.tableFrom, 2);
    await Promise.resolve(); // 等 anchorMainSelection 的微任务。
    const head = view.state.selection.main.head;
    expect(head).toBeGreaterThanOrEqual(model.tableFrom);
    expect(head).toBeLessThanOrEqual(model.tableTo); // 主选区已锚入表内（不再停 pos 0）。
  });
});

/** 在子 view 上同步派发一个 keymap 绑定（绕过真实 DOM 键事件，直跑 run）。 */
function runKey(sub: EditorView, key: string): void {
  const event = new KeyboardEvent('keydown', { key: keyName(key), shiftKey: key.startsWith('Shift-') });
  sub.contentDOM.dispatchEvent(event);
}

/** 派发一个 Mod（非 mac 下 ctrl）修饰的键（测撤销本地优先 keymap）。 */
function runMod(sub: EditorView, key: string): void {
  const event = new KeyboardEvent('keydown', { key, ctrlKey: true });
  sub.contentDOM.dispatchEvent(event);
}

/** "Shift-Tab" → "Tab"、"ArrowRight" 原样（KeyboardEvent.key）。 */
function keyName(key: string): string {
  return key.replace(/^Shift-/, '');
}
