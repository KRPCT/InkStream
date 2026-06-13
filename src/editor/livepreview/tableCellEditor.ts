import { EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { isComposing, queueAfterComposition } from '../composition';
import {
  type NavDir,
  appendRowChange,
  escapePipes,
  navigateCell,
  tableModelAt,
  unescapePipes,
} from './tableModel';
import { clearTableEdit, setTableEdit } from './tableEditState';

/**
 * 方案 B 嵌套迷你 CM6 EditorView 管理层（TABLE-REDESIGN §3 / Wave 1）。
 *
 * 反转方案 A（contenteditable td + textContent commit）：每个**激活的**单元格挂一个独立子 EditorView，
 * 光标任意定位 / 拖拽选区 / 删字符不删格 / 撤销 / 中文 IME 全部由 CM6 内核**原生**承载——子 contentDOM
 * 与主编辑器是同款宿主、同一份 @codemirror 类（直接 import，无 #813 instanceof 断裂）、同一条 Chromium
 * 148 IME 路径。同一时刻**只激活当前单元格一个**子 EditorView（点别格 / Tab 跨格时销毁旧的、武装新的，
 * 把 IME 回归面压到与 A 持平），其余 td 静态只读。
 *
 * 实例存模块级 WeakMap（随主 view 释放，**绝不进 Zustand**）：键 = 主 EditorView，值 = 当前活动子编辑器
 * 记录。`mountCell` 幂等——目标已是当前活动 cell 则复用（blockField 重建 widget 时 updateDOM 原地复用，
 * 不重建子编辑器 → 保 caret / 组合 / 不吞字，§3.4 R2）；目标变了才销毁旧、新建。`destroyActive` 与挂载
 * 严格配对（StrictMode 纪律）。
 *
 * 子→主同步（§3.4 撤销 / commit）：子编辑器**装 history()**（承接本格编辑撤销栈，跨 commit 存活——见
 * mountCell 复用分支）。撤销**本地优先**：Ctrl+Z 先撤子（经 commit 回写主 doc、不动主选区不滚动），子无可撤
 * 再回落主编辑器 undo（cellNavKeymap 的 delegateHistory）。docChanged 即把子 doc 文本经 `escapePipes` 写回
 * 主 doc 的 TableCell 区间（每次从 live 语法树重解析区间，防陈旧）；state.doc 仍唯一真相源。组合期经
 * `queueAfterComposition` 排队、绝不在组合期 dispatch 主 doc（防主 blockField 重建撕掉承载子编辑器的
 * widget DOM → 吞字）。
 *
 * 删除（§5.2）：Backspace/Delete 在子编辑器内是 CM6 原生删字符；单元格删空也是子 doc 内 no-op（不删格）；
 * 子编辑器 keydown 对会越界到主 keymap 的键 `stopPropagation`，绝不冒泡触发主 atomicRanges 原子删整表。
 *
 * 导航（§6）：Tab/Shift+Tab/Enter 跨格切换激活的子编辑器；方向键到子 doc 文本边界时跨格（中部正常移动）。
 */

/** 当前活动子编辑器记录（模块级，单活动变体每主 view 至多一条）。 */
interface ActiveCellEditor {
  /** 嵌套迷你 EditorView 实例。 */
  readonly sub: EditorView;
  /** 承载子编辑器的 td/th（widget DOM 内）。 */
  readonly cell: HTMLElement;
  /** 表格身份键 + 文档序单元格下标（与 tableEditState 对齐）。 */
  readonly tableFrom: number;
  readonly cellIndex: number;
  /** 防子→主写回与主→子回填互相触发的递归门。 */
  syncing: boolean;
}

/** 模块级活动子编辑器表（键 = 主 EditorView，随其释放）。绝不进 Zustand。 */
const activeEditors = new WeakMap<EditorView, ActiveCellEditor>();

/** wrap DOM → 持有它的主 EditorView（供 WidgetType.destroy 反查——destroy(dom) 无 view 句柄）。 */
const wrapOwners = new WeakMap<HTMLElement, EditorView>();

/**
 * 待处理的点击坐标（CDP 自验 a：点单元格中间 → 光标落点击位置，非末尾）。
 *
 * tableGesture 命中静态格 mousedown 时记下 client 坐标；该 cell 经 setTableEdit→重建→armCells→mountCell
 * 新建子编辑器后，由 mountCell 经 `sub.posAtCoords` 把 caret 落到点击处（而非默认末尾）。同一帧消费一次即清。
 */
let pendingClick: { x: number; y: number } | null = null;

/** 记录一次进入编辑的点击坐标（tableGesture mousedown 调用）。 */
export function setPendingClick(x: number, y: number): void {
  pendingClick = { x, y };
}

/** 取某主 view 当前活动子编辑器（无则 null）。 */
export function getActiveCellEditor(main: EditorView): ActiveCellEditor | null {
  return activeEditors.get(main) ?? null;
}

/** 登记 wrap DOM 的持有主 view（armCells 每次调用，供 destroyForWrap 反查）。 */
export function registerWrapOwner(wrap: HTMLElement, main: EditorView): void {
  wrapOwners.set(wrap, main);
}

/**
 * 销毁某 wrap 关联的活动子编辑器（WidgetType.destroy 调用，§3.4 R2 destroy 配对）：表格 widget DOM 被
 * CM6 移除（删表 / 视口滚出 / 结构重建另起 DOM）时，若当前活动子编辑器的 cell 落在该 wrap 内则销毁，
 * 杜绝子 EditorView 实例泄漏。
 */
export function destroyForWrap(wrap: HTMLElement): void {
  const main = wrapOwners.get(wrap);
  if (!main) return;
  const active = activeEditors.get(main);
  if (active && wrap.contains(active.cell)) destroyActive(main);
}

/**
 * 在目标 td 内挂载（或复用）当前单元格的子 EditorView（armCells 调用，幂等）。
 *
 * - 已有活动子编辑器且就是该 cell（同 tableFrom+cellIndex 且 DOM 仍连通）→ 复用（widget updateDOM 原地
 *   复用路径，不重建 → 保 caret/组合存活，§3.4 R2 核心）。
 * - 否则销毁旧活动子编辑器，在该 cell 内新建一个、聚焦（真实手势链内的 focus → IME 武装）。
 */
export function mountCell(
  main: EditorView,
  cell: HTMLElement,
  tableFrom: number,
  cellIndex: number,
): void {
  const existing = activeEditors.get(main);
  if (
    existing &&
    existing.tableFrom === tableFrom &&
    existing.cellIndex === cellIndex &&
    existing.cell.isConnected &&
    existing.sub.dom.isConnected
  ) {
    // 子编辑器实例跨 widget 重建存活（B1 根治）：原地 updateDOM 复用同一 wrap 时，活动 td 已不再被 armCells
    // 预清（清空逻辑移到下方重建分支），故 sub.dom 仍连通 → 走此复用分支，子编辑器实例 / caret / 组合 /
    // 子 history 全部存活，每次 commit 不再重建子编辑器、光标不再跳末尾。若新 DOM 节点不是旧 cell（迁移），
    // 用 replaceChildren 清掉新 cell 可能的静态内容再装 sub.dom（防源文本与子编辑器双显）。
    if (existing.cell !== cell) {
      cell.replaceChildren(existing.sub.dom);
      (existing as { cell: HTMLElement }).cell = cell;
    }
    // 复用同格：仅消费可能的待处理点击坐标（同一格不同位置定位 caret）；无点击则保留子编辑器当前选区
    // （不弹末尾，根治 IME 确认 / 中部编辑后光标跳末尾）。focus 由 focusSub 在焦点丢失且非组合期时才补。
    const click = pendingClick;
    pendingClick = null;
    focusSub(existing.sub, click, true);
    return;
  }
  destroyActive(main);

  // 清空目标 cell（统一在此清，armCells 活动分支不再预清）：toDOM 路径 buildTableBody 会给所有 td（含活动格）
  // 写静态内容，新建子编辑器前须清掉，否则静态文本与子 contentDOM 双显。
  cell.replaceChildren();
  const initial = unescapePipes(cellTextAt(main, tableFrom, cellIndex));
  const sub = new EditorView({
    state: EditorState.create({
      doc: initial,
      extensions: subEditorExtensions(main, () => activeEditors.get(main) ?? null),
    }),
    parent: cell,
  });
  activeEditors.set(main, { sub, cell, tableFrom, cellIndex, syncing: false });
  // 聚焦 + caret 落点（有待处理点击坐标 → 落点击处，CDP 自验 a；否则落末尾，导航/工具条进入）。
  const click = pendingClick;
  pendingClick = null;
  focusSub(sub, click, false);
  // 进新格一次性锚主选区（修撤销跳顶 B2）：延后到微任务脱离 mousedown 手势链，仅当主选区在表外时设到本格起点。
  anchorMainSelection(main, tableFrom, cellIndex);
}

/** 销毁当前主 view 的活动子编辑器（与 mountCell 配对，StrictMode 纪律）。 */
export function destroyActive(main: EditorView): void {
  const active = activeEditors.get(main);
  if (!active) return;
  activeEditors.delete(main);
  active.sub.destroy();
}

/**
 * 聚焦子编辑器 + 定位 caret（同步 + rAF 双补，与主编辑器 focus 同路，IME 武装）。
 *
 * - 有点击坐标（click 非空）→ 经 `sub.posAtCoords` 把 caret 落到点击处（CDP 自验 a，点中部不跳末尾）。
 * - 新建态（preserveSelection=false）且无坐标 → 落文本末尾（导航/工具条进入）。
 * - 复用态（preserveSelection=true）且无坐标 → **保留子编辑器当前选区不动**（根治 IME 确认 / 中部编辑后
 *   光标跳末尾 B1）；且仅在焦点不在子且非组合期时才补 `sub.focus()`——反复 focus 承载 IME 的 contentDOM
 *   有平台相关吞字 / 打断组合风险（Zettlr 同步时从不 focus），已聚焦或组合中一律跳过。
 */
function focusSub(
  sub: EditorView,
  click: { x: number; y: number } | null,
  preserveSelection: boolean,
): void {
  const doFocus = (): void => {
    if (!sub.dom.isConnected) return;
    if (preserveSelection && !click) {
      if (!sub.composing && !sub.hasFocus) sub.focus();
      return;
    }
    sub.focus();
    const head = coordsToPos(sub, click) ?? sub.state.doc.length;
    sub.dispatch({ selection: EditorSelection.cursor(head) });
  };
  doFocus();
  requestAnimationFrame(doFocus);
}

/**
 * 进新单元格时一次性把主编辑器选区锚到本格起点（修撤销跳顶 B2）。
 *
 * 进格手势 / 导航本不动主 selection（防主据表内选区夺焦，见 tableGesture），故主 caret 长期停 pos 0；
 * 子内 undo 耗尽回落主 undo 时，主 undo 恢复 pos 0 选区并 scrollIntoView → 跳文档顶。此处把主选区移进本格
 * 区间：后续 commit 经 changes 映射自然保持表内，回落主 undo 时滚到表格（已在视口）而非文档顶。延后到微任务
 * 执行以脱离 mousedown 手势链（防主据新选区夺焦）；主未聚焦时 CM6 不画光标，无杂散 caret；仅当主选区当前
 * 在表外才设，避免多余事务（doc 起始即表格时 pos 0 已在表内，天然跳过）。
 */
function anchorMainSelection(main: EditorView, tableFrom: number, cellIndex: number): void {
  queueMicrotask(() => {
    const active = activeEditors.get(main);
    if (!active || active.tableFrom !== tableFrom || active.cellIndex !== cellIndex) return;
    const model = tableModelAt(main.state, tableFrom);
    const range = model?.cells[cellIndex];
    if (!model || !range) return;
    const head = main.state.selection.main.head;
    if (head >= model.tableFrom && head <= model.tableTo) return;
    main.dispatch({ selection: EditorSelection.cursor(range.from) });
  });
}

/** 点击坐标 → 子 doc 位置（posAtCoords）；坐标缺失/越界/测量不可用（jsdom）则 null（回落末尾）。 */
function coordsToPos(sub: EditorView, click: { x: number; y: number } | null): number | null {
  if (!click) return null;
  try {
    return sub.posAtCoords({ x: click.x, y: click.y });
  } catch {
    return null; // jsdom 无 elementFromPoint 布局；真机 WebView2 正常解析点击位置（自验 a）。
  }
}

/** 取主 doc 中某 cell 的当前源文本（从 live 语法树重解析区间，剥两侧填充空格）。 */
function cellTextAt(main: EditorView, tableFrom: number, cellIndex: number): string {
  const model = tableModelAt(main.state, tableFrom);
  const range = model?.cells[cellIndex];
  if (!range || range.to > main.state.doc.length) return '';
  return main.state.doc.sliceString(range.from, range.to).trim();
}

/**
 * 子→主同步：把子 doc 文本经 escapePipes 写回主 doc 的 TableCell 区间（单点 dispatch）。
 *
 * 每次从 live 语法树重解析区间（防前一次 commit 触发 widget 重建后 data 属性陈旧）；组合期排队到结束；
 * 与 doc 现值相等则跳过（无空事务）。syncing 门防主→子回填再触发本写回的递归。
 */
function commitSub(main: EditorView, active: ActiveCellEditor): void {
  if (isComposing(main) || active.sub.composing) {
    queueAfterComposition(main, `table-sub-commit-${active.cellIndex}`, () => {
      const cur = activeEditors.get(main);
      if (cur === active) commitSub(main, active);
    });
    return;
  }
  const model = tableModelAt(main.state, active.tableFrom);
  const range = model?.cells[active.cellIndex];
  if (!range || range.to > main.state.doc.length) return;
  const insert = ` ${escapePipes(active.sub.state.doc.toString())} `;
  const current = main.state.doc.sliceString(range.from, range.to);
  if (insert === current) return;
  active.syncing = true;
  main.dispatch({
    changes: { from: range.from, to: range.to, insert },
    userEvent: 'input.table.cell',
  });
  active.syncing = false;
}

/** 子编辑器扩展集：软换行 + 单行源约束 + history 委派 + 子→主同步监听 + 导航/删除 keymap + 事件隔离。 */
function subEditorExtensions(main: EditorView, get: () => ActiveCellEditor | null): Extension {
  return [
    // 软换行（TABLE-ACTIVE-RENDER-DIAG 根因，与主编辑器 extensions.ts 同款）：CM6 的软换行是「扩展」不是
    // 「CSS」——只在 theme 写 white-space:pre-wrap 不够，内核仍按单行测量、scroller 默认 overflow-x:auto
    // 产生横滚。装 lineWrapping 才使内核逐视觉行测量、把行宽约束到 scroller 宽（受 td max-width 约束），
    // 长内容在单元格内折行成多行、不再单行截断 + 横滚（与未激活 td white-space:normal 折行视觉等价）。
    // 注：lineWrapping 软换行不插入 `\n`，与下方 singleLineFilter（拦真实换行入源）正交共存。
    EditorView.lineWrapping,
    history(),
    singleLineFilter,
    drawSelection(),
    EditorView.editable.of(true),
    stopBubblingToMain,
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const active = get();
      if (active && !active.syncing) commitSub(main, active);
    }),
    // 跨格导航 keymap 须高于 defaultKeymap（Tab/方向键/Enter 先判跨格，再回落默认编辑）。
    Prec.high(cellNavKeymap(main, get)),
    // 子编辑器内的常规编辑键位（selectAll/Home/End/词删/光标移动等，Word/Excel 级编辑必备）；
    // 不含 Tab（indentWithTab 不装——Tab 留给跨格导航）。
    keymap.of(defaultKeymap),
    subTheme,
  ];
}

/**
 * 事件隔离（方案 B 核心，CDP 实测 root cause）：子编辑器 contentDOM 在主 contentDOM 子树内，子的
 * input/键盘/组合/指针事件会**冒泡到主编辑器 contentDOM 上的 CM6 监听**——主编辑器据此把子格行为误读为
 * 自己的编辑/选区：
 *   - 键入类（input/beforeinput/key*）：被主读为「主 doc 在 widget 边界处的编辑」（实测：子有焦点、X 却插主 doc）；
 *   - 指针类（mousedown/mousemove/mouseup/click）：被主当成主编辑器的选区手势 → **抢走焦点**（实测：在子内
 *     拖拽框选 / 再点同格后焦点离开子 → 键入落主 doc）。
 * 在子 contentDOM 上 stopPropagation 全部这些事件：子的输入/选区/点击只由子 EditorView 内核消费，绝不上达主。
 *
 * 注：返回 false（undefined）不影响子编辑器自身处理（CM6 仍内部处理），仅阻断向主 contentDOM 冒泡。子组合
 * 不冒泡到主门——子→主写回的组合期判据由 `commitSub` 直接查 `active.sub.composing`，不依赖主门冒泡。
 */
const stopBubblingToMain = EditorView.domEventHandlers({
  beforeinput: (e) => void e.stopPropagation(),
  input: (e) => void e.stopPropagation(),
  keydown: (e) => void e.stopPropagation(),
  keyup: (e) => void e.stopPropagation(),
  keypress: (e) => void e.stopPropagation(),
  compositionstart: (e) => void e.stopPropagation(),
  compositionupdate: (e) => void e.stopPropagation(),
  compositionend: (e) => void e.stopPropagation(),
});

/** 子编辑器单行约束：硬换行（Enter 已被导航 keymap 接管，此处兜底拦粘贴/IME 引入的换行）。 */
const singleLineFilter = EditorState.transactionFilter.of((tr) =>
  tr.docChanged && tr.newDoc.lines > 1 ? [] : tr,
);

/**
 * 跨格导航 + 删除边界 keymap（Prec 高于子编辑器默认）。
 *
 * Tab/Shift+Tab/Enter → 跨格（末格/末行追加行）；方向键到子 doc 文本边界 → 跨格；其余位置交 CM6 原生。
 * Backspace/Delete 不在此拦——子编辑器原生删字符，格首 Backspace 是子 doc 边界 no-op（不删格）；
 * 但统一对导航键 stopPropagation，绝不冒泡到主 keymap 触发 atomicRanges 原子删整表。
 */
function cellNavKeymap(main: EditorView, get: () => ActiveCellEditor | null): Extension {
  const nav = (dir: NavDir, edgeOnly: boolean) => (sub: EditorView): boolean => {
    const active = get();
    if (!active) return false;
    if (edgeOnly && !atEdge(sub, dir)) return false; // 中部移动交 CM6 原生光标。
    moveToCell(main, active, dir);
    return true;
  };
  return keymap.of([
    { key: 'Tab', run: nav('next', false), preventDefault: true },
    { key: 'Shift-Tab', run: nav('prev', false), preventDefault: true },
    { key: 'Enter', run: nav('down', false), preventDefault: true },
    { key: 'ArrowRight', run: nav('next', true) },
    { key: 'ArrowLeft', run: nav('prev', true) },
    { key: 'ArrowDown', run: nav('down', true) },
    { key: 'ArrowUp', run: nav('up', true) },
    // 撤销本地优先（修 B2 跳顶）：子编辑器跨 commit 存活后子 history 累积本格编辑，Ctrl+Z 先撤子（经 commit
    // 回写主、不动主选区不滚动 → 不跳顶），子无可撤再回落主编辑器 undo（此时主选区已被 anchorMainSelection
    // 锚在表内，主 undo 滚到表格而非文档顶）。redo 同理。
    { key: 'Mod-z', run: (sub) => undo(sub) || delegateHistory(main, 'undo'), preventDefault: true },
    { key: 'Mod-y', run: (sub) => redo(sub) || delegateHistory(main, 'redo'), preventDefault: true },
    { key: 'Mod-Shift-z', run: (sub) => redo(sub) || delegateHistory(main, 'redo'), preventDefault: true },
  ]);
}

/** 子编辑器光标是否在指定方向的文本边界（用于方向键跨格判定）。 */
function atEdge(sub: EditorView, dir: NavDir): boolean {
  const head = sub.state.selection.main.head;
  if (dir === 'prev' || dir === 'up') return head === 0;
  return head === sub.state.doc.length;
}

/** 把 historyKeymap 的 undo/redo 委派回主编辑器（子不持权威 history）。 */
function delegateHistory(main: EditorView, kind: 'undo' | 'redo'): boolean {
  const cmd = historyKeymap.find((b) => b.key === (kind === 'undo' ? 'Mod-z' : 'Mod-y'));
  return cmd?.run ? cmd.run(main) : false;
}

/**
 * 跨格导航：先 commit 当前格 → 算目标 → dispatch 新编辑态（cell）/ 退出（exit）/ 末尾追加行（appendRow）。
 *
 * dispatch setTableEdit 触发 blockField 重建 → TableWidget 据新 activeCellIndex 武装目标格 → armCells
 * 在目标 td 内挂新子编辑器（旧子编辑器在 mountCell 内被 destroyActive 销毁）。
 */
function moveToCell(main: EditorView, active: ActiveCellEditor, dir: NavDir): void {
  commitSub(main, active);
  const model = tableModelAt(main.state, active.tableFrom);
  if (!model) return;
  const result = navigateCell(active.cellIndex, model.columns, model.cells.length, dir);
  if (result.kind === 'cell') {
    main.dispatch({ effects: setTableEdit.of({ tableFrom: model.tableFrom, cellIndex: result.cellIndex }) });
    return;
  }
  if (result.kind === 'exit') {
    const pos = result.before
      ? Math.max(0, model.tableFrom - 1)
      : Math.min(model.tableTo, main.state.doc.length);
    main.dispatch({ effects: clearTableEdit.of(null), selection: EditorSelection.cursor(pos) });
    main.focus();
    return;
  }
  const change = appendRowChange(model);
  main.dispatch({
    changes: { from: change.at, insert: change.insert },
    effects: setTableEdit.of({
      tableFrom: model.tableFrom,
      cellIndex: change.firstCellIndexAfter + result.column,
    }),
  });
}

/**
 * 子编辑器外观：**填满整个单元格**且与未激活 td 盒几何**完全一致**（透明背景、无外框、无放大跳变）。
 *
 * 撑满（CDP 实测）：子 .cm-editor 须撑满 td 宽，「点单元格任意处（含文本两侧留白）」才落在子 contentDOM 上
 * → 子原生定位 caret / 拖拽框选稳获焦点；否则点留白落在 td 边缘 → 焦点不进子、拖拽丢焦。
 *
 * 几何一致（TABLE-RENDER-DIAG 根因一，修激活放大跳变）：子 `.cm-content` 物理嵌在外层主编辑器
 * `.cm-content` 子树内，会经 descendant 组合子吃到外层 base theme 的 `.cm-content { padding-block:2rem }`
 * （CDP 实测：子 content padding 被污染成 32px → td 撑到 92px、点击瞬间放大）。外层规则形如 `.ͼN .cm-content`
 * （特异度 0,2,0），与本 theme 同 0,2,0 时**源序后者赢但外层胜出（实测）**，故此处用更高特异度选择器
 * `.cm-scroller .cm-content`（0,3,0）**无条件压过**外层，把 padding 强制回 td 同款 7px 13px、清掉撑高链
 * （不设 height:100% / scroller min-height:100% —— 它们把 32px 反灌成行高）。激活前后单元格盒几何一致。
 *
 * 换行（与 td 一致，TABLE-ACTIVE-RENDER-DIAG 修复）：软换行靠 `EditorView.lineWrapping` 扩展（见
 * subEditorExtensions），本 theme 仅配套——content `white-space:pre-wrap`（保行内空格 + 配合软换行）、
 * scroller `overflow-x:hidden`（兜底去横滚，即便有不可折断长串也不出滚动条，与表格语义一致）、
 * content/line `text-align:left`（钉死左对齐，杜绝继承漂移与单行溢出的伪居中错觉）。激活前后版式一致。
 */
const subTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', width: '100%' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
    // 去横向滚动条（修复三）：lineWrapping 后内容不横向溢出，此处 hidden 兜底 —— 未来出现不可折断长串
    // （URL/连续 ASCII）也不引入横滚条，单元格内永不水平滚动。
    overflowX: 'hidden',
  },
  // scroller 横向 padding 归零（任务二：左边缘对齐，CDP 根因）：主编辑器 editorBaseTheme 给 `.cm-scroller`
  // 设 `padding-inline: max(版心居中留白, 1.5rem)`——子 EditorView 的 scroller 物理嵌在主 .cm-content 子树内，
  // 经 descendant 组合子 `.ͼN .cm-scroller`（0,2,0）吃到这条；窄单元格下 max() 落到 1.5rem=24px 下限，
  // 把子内容整体右推 24px（叠在 content 的 13px 上 → 激活态文字左起 37px，比未激活 td 的 13px 多 24px、点击位移）。
  // 本 theme 的 `.cm-scroller`（0,1,0）压不过，故用 `&.cm-editor .cm-scroller`（.cm-editor.cm-editor .cm-scroller
  // = 0,3,0）无条件清零 padding-inline——激活态文字左起 = content 的 13px，与未激活 td 完全对齐、零位移。
  '&.cm-editor .cm-scroller': { paddingInline: '0' },
  // 高特异度（.cm-scroller .cm-content = 0,3,0）压过外层 base theme 的 .cm-content（0,2,0）2rem 纵 padding：
  // 把内边距强制回 td 同款 7px 13px（激活前后盒几何一致，无跳变）；配合 lineWrapping 软换行与 td 视觉等价；
  // 不设 min-height（撑高链根因，CDP 实测移除后行高回落与未激活同量级）；text-align 左对齐（修复四）。
  '.cm-scroller .cm-content': {
    padding: '7px 13px',
    caretColor: 'var(--text-normal)',
    minHeight: 'auto',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    textAlign: 'left',
  },
  // .cm-line 左 padding 归零（任务二：左边缘对齐）：CM6 baseTheme 给 `.cm-line` 默认 `padding:0 2px 0 6px`，
  // 叠在 .cm-content 的 13px 左 padding 上 → 激活态文字左起 19px，比未激活 td（直接 13px）多 6px、点击前后位移。
  // 单 class `.cm-line`（0,1,0）特异度不足以压过 baseTheme（lineWrapping 命中后更高/同序在后，实测残留 6px），
  // 故用 `.cm-scroller .cm-line`（0,3,0）无条件归零——激活态文字左起 = .cm-content 的 13px，与未激活 td 完全对齐。
  '.cm-scroller .cm-line': { padding: '0', textAlign: 'left' },
  '&.cm-focused': { outline: 'none' },
});
