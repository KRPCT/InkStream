import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { BLOCK_REPLACE } from './nodeNames';
import { TableWidget } from './widgets/TableWidget';
import { refreshLivePreview } from './composingGuard';

/**
 * 块级层 StateField（EDIT-03 / RESEARCH Pattern 2 + 4 / Pitfall 3，三层范式块级支柱）。
 *
 * 职责：对 GFM 表格（BLOCK_REPLACE 节点）整块替换为 TableWidget——
 *   - 表格行范围与主选区不相交 → `Decoration.replace({ widget: new TableWidget(text), block: true })`（渲染真表格）；
 *   - 表格行范围与主选区相交（EDIT-06 Option 2，与行内层活动行契约对齐）→ 不替换（整块还原源码 Markdown，
 *     D-06 原子块级），故也不进 atomicRanges，活动行恒为可编辑纯源码。
 *
 * 块级 replace **必须**从 StateField 经 `provide(EditorView.decorations.from)` 提供——官方约束：
 * 改变文档块结构的 block-replacing 装饰不得从 ViewPlugin 给（RESEARCH Pitfall 3）。
 *
 * atomicRanges（Pattern 4）：`tableAtomicRanges` 喂同一替换 RangeSet，使键盘 moveByChar/Backspace
 * 把表格 widget 当原子跳过（光标不卡进 widget；进块经整块还原退回可编辑源码）。
 *
 * IME（EDIT-06，Option 1）：不再自建 composition 冻结闸门——CM6 6.43.1 内置合成范围保护，组合期的
 * docChange 事务照常走 buildBlockState 规范重建（CM6 自身保护正在合成的文本节点）。UAT #8 的选区复用
 * 优化（仅跨表格边界才重建、普通选区移动零语法树访问）是与 IME 正交的纯性能关切，照旧保留。
 *
 * 与行内层（ViewPlugin）共存于 livePreviewExtensions——CM6 自动合并多个 decorations facet 输入
 * （行内 mark/line 装饰 + 块级 replace 装饰 range 不重叠，无冲突，Pattern 3）。
 */

/** 块级表格 range（from,to 闭区间起止）。 */
export interface TableRange {
  readonly from: number;
  readonly to: number;
}

/** blockField 持有的内部态：替换装饰集 + 全部表格块 range（含光标当前还原的块）。 */
interface BlockState {
  /** 块级替换 DecorationSet（光标在块内的表格不在此集——整块还原源码 D-06）。 */
  readonly deco: DecorationSet;
  /** 全部表格块 range（无论是否被替换）：供选区移动时 O(blocks) 判定边界跨越。 */
  readonly tables: readonly TableRange[];
}

/**
 * 全文扫描一次语法树，产出全部表格块 range + 据当前光标构建的替换装饰集。
 *
 * 整文档迭代——块级原子块跨多行、非视口局部，须全文判定（D-06 整块还原依赖全表覆盖，
 * 且 atomicRanges 须覆盖所有表格含视口外）。每次扫描只发生于 doc 变 / refresh，**绝不在
 * 普通选区移动时触发**（那条路径走 selectionCrossesBoundary 的 O(blocks) 边界判定，见 update）。
 *
 * 对每个 BLOCK_REPLACE 节点：登记其 range；光标在块内则跳过替换（整块还原 D-06），否则加
 * block replace 装饰。同源 TableWidget eq 复用 DOM（防闪烁）。RangeSetBuilder 按位置序 O(n) 构建。
 */
function buildBlockState(state: EditorState): BlockState {
  const builder = new RangeSetBuilder<Decoration>();
  const tables: TableRange[] = [];
  // 活动行集（EDIT-06 Option 2）：与行内层同源，仅据**主选区**算 [firstLine,lastLine]。
  // 表格只要其行范围与主选区相交即整块还原源码——与行内层「活动行纯源码」契约对齐：
  // 触到活动行的表格不发 block-replace 装饰，故也不进 atomicRanges，活动行恒为可编辑纯源码。
  const sel = state.selection.main;
  const selFirstLine = state.doc.lineAt(sel.from).number;
  const selLastLine = state.doc.lineAt(sel.to).number;
  const tableTouchesActiveLine = (from: number, to: number): boolean => {
    const tFirst = state.doc.lineAt(from).number;
    const tLast = state.doc.lineAt(to).number;
    return tFirst <= selLastLine && tLast >= selFirstLine;
  };
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!BLOCK_REPLACE.has(node.name)) return undefined;
      tables.push({ from: node.from, to: node.to });
      // 表格行范围与主选区相交 → 整块还原源码（不替换），并跳过子树。
      if (tableTouchesActiveLine(node.from, node.to)) return false;
      const text = state.doc.sliceString(node.from, node.to);
      builder.add(
        node.from,
        node.to,
        Decoration.replace({ widget: new TableWidget(text), block: true }),
      );
      return false; // 块级节点子树无需再迭代。
    },
  });
  return { deco: builder.finish(), tables };
}

/**
 * 主选区（state.selection.main，[from,to] 行范围）触到哪些表格块的「指纹」——按表起点拼接。
 *
 * 用行号区间相交（与 buildBlockState 的 tableTouchesActiveLine 同源）判定：选区行 [selFirst,selLast]
 * 与表格行 [tFirst,tLast] 相交即触及。指纹只记被触及表格的 from 序列，O(blocks)，无语法树访问。
 */
function touchedTablesFingerprint(tables: readonly TableRange[], state: EditorState): string {
  const sel = state.selection.main;
  const selFirst = state.doc.lineAt(sel.from).number;
  const selLast = state.doc.lineAt(sel.to).number;
  const touched: number[] = [];
  for (const t of tables) {
    const tFirst = state.doc.lineAt(t.from).number;
    const tLast = state.doc.lineAt(t.to).number;
    if (tFirst <= selLast && tLast >= selFirst) touched.push(t.from);
  }
  return touched.join(',');
}

/**
 * 选区变化时的复用判据（性能核心：消除每次点击的 O(doc) 全树重算）。
 *
 * 仅当主选区触及的表格块集合实际变化（进块 ↔ 出块 ↔ 换块 ↔ 多行选区跨表）才重建——驱动 D-06 整块
 * 还原切换；否则（选区在同一表格内移动、或始终在所有表格外移动）原样复用，零语法树访问。
 *
 * 表格 range 取自上一次全文扫描固化的 `prev.tables`（doc 未变故仍准确）；旧/新各 O(blocks) 行号比对。
 */
function selectionCrossesBoundary(prev: BlockState, tr: { startState: EditorState; state: EditorState }): boolean {
  const oldFp = touchedTablesFingerprint(prev.tables, tr.startState);
  const newFp = touchedTablesFingerprint(prev.tables, tr.state);
  return oldFp !== newFp;
}

/**
 * 块级层 StateField：持 BlockState（替换 DecorationSet + 全表 range），经 provide 提供其装饰子集。
 *
 * update 重建判据（按代价升序短路）：
 *   1. docChanged：全文扫描重建（doc 结构可能变，表格 range 须刷新）——组合期 docChange 亦走此路
 *      （CM6 6.43.1 内置合成保护，无需自建闸门，EDIT-06 Option 1）。
 *   2. 选区变化：仅当主选区触及的表格块集合变化才重建（O(blocks) 行号判定）；普通移动原样复用——
 *      消除每次点击的 O(doc) 全树重算（UAT #8 卡顿根因，与 IME 正交的纯性能优化，照旧保留）。
 */
export const blockField = StateField.define<BlockState>({
  create: (state) => buildBlockState(state),
  update(prev, tr) {
    // 0. IME 冻结闸门（EDIT-06，root cause B）：块级 StateField 无 view，据 CM6 原生 userEvent
    //    `input.type.compose` 识别组合事务。组合期绝不全文扫描重建（撕表格 widget DOM → 吞字）；
    //    docChanged 时 map 旧 deco + 表格 range 跟随位移——返回未映射的旧集会让插入点后的替换装饰 /
    //    atomicRanges 错位，CM6 据此重建合成中的 DOM（同样吞字）。映射为 O(blocks) 位移，不扫语法树。
    if (tr.isUserEvent('input.type.compose')) {
      if (!tr.docChanged) return prev; // 纯组合 selection 无文档变：保旧态不动。
      return {
        deco: prev.deco.map(tr.changes),
        tables: prev.tables.map((t) => ({
          from: tr.changes.mapPos(t.from),
          to: tr.changes.mapPos(t.to),
        })),
      };
    }
    // 1. doc 变 / compositionend 强刷：全文扫描重建（refreshLivePreview 解冻后还原渲染态，CR-01）。
    const refreshed = tr.effects.some((e) => e.is(refreshLivePreview));
    if (tr.docChanged || refreshed) return buildBlockState(tr.state);
    // 2. 选区变化：仅跨越表格块边界才重建（O(blocks)），否则复用——不做全树 O(doc) 重算（UAT #8）。
    if (tr.selection && selectionCrossesBoundary(prev, tr)) {
      return buildBlockState(tr.state);
    }
    return prev;
  },
  provide: (field) => EditorView.decorations.from(field, (s) => s.deco),
});

/**
 * 表格 atomicRanges（Pattern 4）：喂 blockField 的替换 RangeSet。
 *
 * 键盘光标移动（moveByChar/moveVertically/Backspace）把表格 widget range 当原子跳过；
 * programmatic selection（view.dispatch({selection})）不受约束（RESEARCH Pattern 4 注意）。
 */
export const tableAtomicRanges = EditorView.atomicRanges.of(
  (view) => view.state.field(blockField).deco,
);

/**
 * 块级层样式（UI-SPEC GFM 表格）：真 <table> 边框 / 表头底色 / 单元格内边距。
 *
 * 取色复用 theme.css 的 --cm-table-border / --cm-table-header-bg（亮暗双套，在册），
 * 内边距 sm(8px) 上下 / sm2(12px) 左右；**永不硬编码色值**（highlightTheme.ts 纪律）。
 */
const tableTheme = EditorView.theme({
  '.cm-ink-table': {
    borderCollapse: 'collapse',
    border: '1px solid var(--cm-table-border)',
  },
  '.cm-ink-table th, .cm-ink-table td': {
    border: '1px solid var(--cm-table-border)',
    padding: '8px 12px',
  },
  '.cm-ink-table th': {
    backgroundColor: 'var(--cm-table-header-bg)',
    fontWeight: '600',
  },
});

/**
 * 块级层组合（挂入 livePreviewExtensions）：blockField（decorations provide）+ atomicRanges + 样式。
 */
export const blockExtensions = [blockField, tableAtomicRanges, tableTheme];
