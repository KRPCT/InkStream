import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import {
  BLOCK_MATH_CONTENT,
  BLOCK_MATH_NODE,
  BLOCK_REPLACE,
  CODE_INFO_NODE,
  CODE_TEXT_NODE,
  FENCED_CODE_NODE,
  LATEX_INFO,
  MATH_INFO,
  TYPST_INFO,
} from './nodeNames';
import { TableWidget } from './widgets/TableWidget';
import { MathWidget } from './widgets/MathWidget';
import { LatexWidget } from './widgets/LatexWidget';
import { TypstWidget } from './widgets/TypstWidget';
import { FormulaEditWidget } from './widgets/FormulaEditWidget';
import type { FormulaEngine } from './formulaPreview';
import { clearFormulaEdit, formulaEditState, setFormulaEdit } from './formulaEditState';
import { tableModelFromNode } from './tableModel';
import { tableStructFromNode } from './tableOps';
import { clearTableEdit, setTableEdit, tableEditState } from './tableEditState';
import { isComposingTr, refreshLivePreview } from '../composition';

/**
 * 块级层 StateField（EDIT-03 / RESEARCH Pattern 2 + 4 / Pitfall 3，三层范式块级支柱）。
 *
 * 职责（Typora 式就地编辑反转）：对 GFM 表格（BLOCK_REPLACE 节点）**恒**整块替换为 TableWidget
 * （表格始终保持渲染态，不再「光标进表格 → 整块还原源码」）。就地编辑发生在 widget 内部的
 * contenteditable 单元格——blockField 据 `tableEditState` 把活动单元格下标透传给 TableWidget，
 * 由 widget 把对应 td/th 设 contenteditable 并聚焦；装饰不撤、表格不变源码（TABLE-WYSIWYG-DESIGN §2.2）。
 *
 * 块级 replace **必须**从 StateField 经 `provide(EditorView.decorations.from)` 提供——官方约束：
 * 改变文档块结构的 block-replacing 装饰不得从 ViewPlugin 给（RESEARCH Pitfall 3）。
 *
 * atomicRanges（Pattern 4）：`tableAtomicRanges` 喂同一替换 RangeSet，使键盘 moveByChar/Backspace
 * 把表格 widget 当原子跳过（光标不卡进 widget；单元格导航由 widget 内部 keydown 接管）。
 *
 * IME（重构设计 §4.4）：组合判据收口到统一冻结门——块级 StateField 无 view，据门的 isComposingTr(tr)
 * 识别组合事务，组合期 map 旧装饰而非重建（保住正在合成的文本节点 DOM）。UAT #8 的选区复用优化
 * （仅跨表格边界才重建、普通选区移动零语法树访问）是与 IME 正交的纯性能关切，照旧保留。
 *
 * 与行内层（ViewPlugin）共存于 livePreviewExtensions——CM6 自动合并多个 decorations facet 输入
 * （行内 mark/line 装饰 + 块级 replace 装饰 range 不重叠，无冲突，Pattern 3）。
 */

/**
 * 相邻表格分隔空行装饰（任务一，行级 class，不改文本）：两张表之间 GFM 强制保留的单个空行——渲染层经
 * `cm-ink-table-gap` 把其行高坍缩为 0（tableTheme 提供样式），两表块间距改由表格自身 margin 提供，
 * 视觉上无突兀空白行。仅命中「恰好夹在两表间的单空行」，普通段落空行不受影响（buildBlockState 判定收口）。
 */
const TABLE_GAP_LINE = Decoration.line({ class: 'cm-ink-table-gap' });

/** ensureSyntaxTree 强制解析整篇的时间预算（ms）；长文档远处表格须强制解析才有 Table 节点可渲染。 */
const FORCE_PARSE_BUDGET_MS = 100;

/** 块级表格 range（from,to 闭区间起止）。 */
export interface TableRange {
  readonly from: number;
  readonly to: number;
}

/** blockField 持有的内部态：替换装饰集 + 表格块 range + math 块 range。 */
interface BlockState {
  /** 块级替换 DecorationSet（表格恒渲染；math 块仅在光标不在块内时入集）。 */
  readonly deco: DecorationSet;
  /** 全部表格块 range（恒渲染 + atomic）：供选区移动时 O(blocks) 判定边界跨越。 */
  readonly tables: readonly TableRange[];
  /**
   * 全部 ```math 块 range（无论是否被替换）：供边界判定（光标进/出触发还原↔渲染切换）。
   * **不入 atomicRanges**——否则光标无法进块还原源码（math 走「光标进块显源码」而非表格的「恒渲染 + 嵌套编辑」）。
   */
  readonly formulaBlocks: readonly TableRange[];
}

/** 块级原子 range 全集（表格 + math）：边界指纹覆盖两者，否则光标进 math 块不触发重建、源码不还原。 */
function allBlockRanges(s: BlockState): readonly TableRange[] {
  return s.formulaBlocks.length === 0 ? s.tables : [...s.tables, ...s.formulaBlocks];
}

/**
 * 全文扫描一次语法树，产出全部表格块 range + 替换装饰集（表格恒渲染，据 tableEditState 武装活动 cell）。
 *
 * 整文档迭代——块级原子块跨多行、非视口局部，须全文判定（atomicRanges 须覆盖所有表格含视口外）。
 * 每次扫描只发生于 doc 变 / refresh / 编辑态切换，**绝不在普通选区移动时触发**（那条路径走
 * selectionCrossesBoundary 的 O(blocks) 边界判定，见 update）。
 *
 * 对每个 BLOCK_REPLACE（Table）节点：登记其 range，迭代子树收集全部 TableCell 区间（cellRanges，
 * 供 widget commit 单点 dispatch），并恒加 block replace 装饰（表格始终渲染，反转「光标进块还原源码」）；
 * 若该表 from 命中 tableEditState.tableFrom，把活动 cellIndex 透传给 TableWidget（武装该 cell）。
 * 同源 TableWidget eq 复用 DOM（防闪烁）。RangeSetBuilder 按位置序 O(n) 构建。
 */
function buildBlockState(state: EditorState): BlockState {
  const builder = new RangeSetBuilder<Decoration>();
  const tables: TableRange[] = [];
  const formulaBlocks: TableRange[] = [];
  // 主选区行范围（math 块据此判「光标进块」→ 还原源码；表格恒渲染不用）。
  const sel = state.selection.main;
  const selFirstLine = state.doc.lineAt(sel.from).number;
  const selLastLine = state.doc.lineAt(sel.to).number;
  // 当前就地编辑态（tableFrom + cellIndex），若有则透传给对应表的 widget 武装该 cell。
  const edit = state.field(tableEditState, false) ?? null;
  // 公式块双栏编辑态（W3）：该块在 formulaEditState 中 → 渲 FormulaEditWidget（编辑态 > 光标进块 > 就地渲染）。
  const fEdit = state.field(formulaEditState, false) ?? null;
  // 上一张表末行行号（无则 -1）：用于判定本表与上表间是否「恰好一空行」（任务一分隔空行收口）。
  let prevTableLastLine = -1;
  // 强制解析整篇（长文档关键）：CM6 默认只解析到视口附近，远处 Table 节点未产出致表格显示源码。
  const tree = ensureSyntaxTree(state, state.doc.length, FORCE_PARSE_BUDGET_MS) ?? syntaxTree(state);
  tree.iterate({
    enter: (node) => {
      // fenced 公式块（FencedCode + CodeInfo 首词）：math→KaTeX(MathWidget) / latex→MathJax(LatexWidget)。
      // 光标进块还原源码、否则渲染 widget（与表格「恒渲染」各走各判定）；块 range 登记 formulaBlocks 供边界
      // 判定（进/出触发还原↔渲染）。两引擎同范式（边界还原 + 占位重建），仅 widget 不同。
      if (node.name === FENCED_CODE_NODE) {
        const info = node.node.getChild(CODE_INFO_NODE);
        const infoText = info
          ? state.doc.sliceString(info.from, info.to).trim().split(/\s+/)[0]
          : '';
        if (infoText === MATH_INFO || infoText === LATEX_INFO || infoText === TYPST_INFO) {
          formulaBlocks.push({ from: node.from, to: node.to });
          const codeText = node.node.getChild(CODE_TEXT_NODE);
          const src = codeText ? state.doc.sliceString(codeText.from, codeText.to) : '';
          // 三态判定（W3）：① 双栏编辑态优先 → FormulaEditWidget；② 光标进块 → 显源码；③ 否则就地渲染。
          if (fEdit && fEdit.blockFrom === node.from) {
            builder.add(
              node.from,
              node.to,
              Decoration.replace({
                widget: new FormulaEditWidget(infoText as FormulaEngine, src, node.from),
                block: true,
              }),
            );
            return false;
          }
          const firstLine = state.doc.lineAt(node.from).number;
          const lastLine = state.doc.lineAt(node.to).number;
          const cursorInBlock = firstLine <= selLastLine && lastLine >= selFirstLine;
          if (!cursorInBlock) {
            const widget =
              infoText === MATH_INFO
                ? new MathWidget(src, node.from, node.to)
                : infoText === LATEX_INFO
                  ? new LatexWidget(src, node.from, node.to)
                  : new TypstWidget(src, node.from, node.to);
            builder.add(node.from, node.to, Decoration.replace({ widget, block: true }));
          }
        }
        return false; // 不下钻 FencedCode 子树（公式块已处理；其它代码块本期不渲染）
      }
      // 块公式 $$...$$（FEAT-INLINE-MATH，自研 BlockMath 节点，非 FencedCode）：与 ```math 围栏平行——同 MathWidget、
      // 同 formulaBlocks 边界（光标进块显源码/出块渲染），共享 KaTeX；不入 atomicRanges（保光标能进块还原源码）。
      if (node.name === BLOCK_MATH_NODE) {
        formulaBlocks.push({ from: node.from, to: node.to });
        const content = node.node.getChild(BLOCK_MATH_CONTENT);
        const src = content ? state.doc.sliceString(content.from, content.to) : '';
        if (fEdit && fEdit.blockFrom === node.from) {
          builder.add(
            node.from,
            node.to,
            Decoration.replace({ widget: new FormulaEditWidget('math', src, node.from), block: true }),
          );
          return false;
        }
        const firstLine = state.doc.lineAt(node.from).number;
        const lastLine = state.doc.lineAt(node.to).number;
        const cursorInBlock = firstLine <= selLastLine && lastLine >= selFirstLine;
        if (!cursorInBlock) {
          builder.add(
            node.from,
            node.to,
            Decoration.replace({ widget: new MathWidget(src, node.from, node.to), block: true }),
          );
        }
        return false; // 整块处理，不下钻子节点
      }
      if (!BLOCK_REPLACE.has(node.name)) return undefined;
      tables.push({ from: node.from, to: node.to });
      // 相邻表格分隔空行收口（任务一，TABLE-POLISH-DIAG §任务一）：本表与上一张表之间**恰好一行**
      // （本表首行 = 上表末行 + 2）且那一行内容为空时，给该空行 add 一条 gap line 装饰——渲染层把它
      // 高度坍缩为 0，两表间距改由表格自身 margin 提供（doc 空行原样保留，守 GFM 真相源）。多空行 /
      // 表段之间不命中。gap 行 from（上表末 +1 行起点）严格落在「上表 replace.to」与「本表 replace.from」
      // 之间，故须在本表 replace.add 之前 add，保 RangeSetBuilder 升序。
      const thisFirstLine = state.doc.lineAt(node.from).number;
      if (prevTableLastLine >= 0 && thisFirstLine === prevTableLastLine + 2) {
        const gapLine = state.doc.line(prevTableLastLine + 1);
        if (gapLine.text.trim().length === 0) builder.add(gapLine.from, gapLine.from, TABLE_GAP_LINE);
      }
      prevTableLastLine = state.doc.lineAt(node.to).number;
      // 据行 delimiter 切分收集各列区间 + 列数（含空 cell；tableModelFromNode 共用纯逻辑）。
      const model = tableModelFromNode(node.node);
      const cells = model ? model.cells : [];
      const columns = model ? model.columns : 0;
      // 列对齐由对齐分隔行解析（tableStructFromNode 共用，喂 td/th 的 text-align）。
      const struct = tableStructFromNode(node.node, (from, to) => state.doc.sliceString(from, to));
      const aligns = struct ? struct.aligns : [];
      const text = state.doc.sliceString(node.from, node.to);
      const activeCellIndex = edit && edit.tableFrom === node.from ? edit.cellIndex : null;
      builder.add(
        node.from,
        node.to,
        Decoration.replace({
          widget: new TableWidget(text, node.from, cells, activeCellIndex, columns, aligns),
          block: true,
        }),
      );
      return false; // 块级节点子树无需再迭代（cells 已在 tableModelFromNode 内取齐）。
    },
  });
  return { deco: builder.finish(), tables, formulaBlocks };
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
function selectionCrossesBoundary(
  prev: BlockState,
  tr: { startState: EditorState; state: EditorState },
): boolean {
  const ranges = allBlockRanges(prev);
  const oldFp = touchedTablesFingerprint(ranges, tr.startState);
  const newFp = touchedTablesFingerprint(ranges, tr.state);
  return oldFp !== newFp;
}

/**
 * 块级层 StateField：持 BlockState（替换 DecorationSet + 全表 range），经 provide 提供其装饰子集。
 *
 * update 重建判据（按代价升序短路）：
 *   1. docChanged：全文扫描重建（doc 结构可能变，表格 range 须刷新）——组合期 docChange 先被门
 *      isComposingTr(tr) 短路走 map（见 update 步骤 0），不进此重建路径。
 *   2. 就地编辑态切换（setTableEdit/clearTableEdit effect）：全文扫描重建，使新的 activeCellIndex
 *      透传给对应表的 widget（武装/撤销该 cell 的 contenteditable）。O(doc) 但仅发生于点击/导航/退出，非热路径。
 *   3. 选区变化：表格恒渲染，选区移动不再触发整块还原；仅当触及的表格集合变化时重建（保持装饰新鲜，
 *      与未来块级元素扩展兼容），普通移动原样复用——零语法树访问（UAT #8 性能优化保留）。
 */
export const blockField = StateField.define<BlockState>({
  create: (state) => buildBlockState(state),
  update(prev, tr) {
    // 0. IME 冻结门（重构设计 §4.4，root cause B）：块级 StateField 无 view，据门的 isComposingTr(tr)
    //    （annotation ∪ CM6 原生 input.type.compose ∪ frozen 双判）识别组合事务，与行内层 isComposing(view)
    //    同源（CR-01 消除）。组合期绝不全文扫描重建（撕表格 widget DOM → 吞字）；docChanged 时 map 旧 deco +
    //    表格 range 跟随位移——返回未映射的旧集会让插入点后的替换装饰 / atomicRanges 错位，CM6 据此重建
    //    合成中的 DOM（同样吞字）。映射为 O(blocks) 位移，不扫语法树。
    if (isComposingTr(tr)) {
      if (!tr.docChanged) return prev; // 纯组合 selection 无文档变：保旧态不动。
      const mapRange = (t: TableRange) => ({
        from: tr.changes.mapPos(t.from),
        to: tr.changes.mapPos(t.to),
      });
      return {
        deco: prev.deco.map(tr.changes),
        tables: prev.tables.map(mapRange),
        formulaBlocks: prev.formulaBlocks.map(mapRange),
      };
    }
    // 1. doc 变 / compositionend 强刷 / 就地编辑态切换：全文扫描重建。
    //    refreshLivePreview 解冻后还原渲染态（CR-01）；editChanged 使新 activeCellIndex 透传武装单元格。
    const refreshed = tr.effects.some((e) => e.is(refreshLivePreview));
    const editChanged = tr.effects.some(
      (e) =>
        e.is(setTableEdit) ||
        e.is(clearTableEdit) ||
        e.is(setFormulaEdit) ||
        e.is(clearFormulaEdit),
    );
    if (tr.docChanged || refreshed || editChanged) {
      const rebuilt = buildBlockState(tr.state);
      return rebuilt;
    }
    // 1.5 语法树推进即重建（长文档关键，根治「只有开头几张表渲染」）：CM6 增量解析器有工作预算，长文档
    //    初始 syntaxTree(state) 只解析到视口附近，远处 Table 节点尚未产出 → buildBlockState 扫不到 → 那些表
    //    显示源码。后台 parseWorker 在 idle 中逐步补齐，每推进一步 dispatch 一条**无 docChange/selection**
    //    的事务——旧 update 不重建故装饰永不刷新。此处比对语法树对象身份：解析推进时 syntaxTree 产出新树
    //    → 重建，使新解析出的表格渲染。纯选区/无关事务树身份不变，不触发。组合期事务已在步骤 0 提前返回，
    //    不达此处（不撕合成 DOM）。
    if (syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return buildBlockState(tr.state);
    }
    // 2. 选区变化：表格恒渲染，仅当触及的表格集合变化才重建（保装饰新鲜），普通移动原样复用（UAT #8）。
    if (tr.selection && selectionCrossesBoundary(prev, tr)) {
      return buildBlockState(tr.state);
    }
    return prev;
  },
  provide: (field) => EditorView.decorations.from(field, (s) => s.deco),
});

/** atomicRanges 用的占位替换装饰（仅取 range 边界，值本身不参与渲染）。 */
const ATOMIC_MARK = Decoration.replace({});

/**
 * 表格 atomicRanges（Pattern 4）：键盘光标移动（moveByChar/moveVertically/Backspace）把表格 widget 当原子跳过；
 * programmatic selection（view.dispatch({selection})）不受约束。
 *
 * **仅喂表格 range（不含 math 块）**：表格恒渲染、原子跳过 + 嵌套编辑；math 块走「光标进块还原源码」，
 * 若也设为原子则光标无法进块（键盘跳过、点击落边界）→ 永远无法编辑源码。故 math 块**不入** atomicRanges，
 * 光标可自由进块触发还原（blockField 据选区相交 skip 装饰）。
 */
export const tableAtomicRanges = EditorView.atomicRanges.of((view) => {
  const builder = new RangeSetBuilder<Decoration>();
  for (const t of view.state.field(blockField).tables) builder.add(t.from, t.to, ATOMIC_MARK);
  return builder.finish();
});

/**
 * 公式块双栏编辑期 atomicRanges（W3）：仅**正在双栏编辑的那一个块**整块入原子（键盘光标不游离进围栏行，
 * 编辑只在 textarea 里）。非编辑态公式块**不入**（保留 Phase 5「光标可进块显源码」轻量内联编辑）。
 */
export const formulaAtomicRanges = EditorView.atomicRanges.of((view) => {
  const builder = new RangeSetBuilder<Decoration>();
  const fEdit = view.state.field(formulaEditState, false);
  if (fEdit) {
    for (const b of view.state.field(blockField).formulaBlocks) {
      if (b.from === fEdit.blockFrom) builder.add(b.from, b.to, ATOMIC_MARK);
    }
  }
  return builder.finish();
});

/**
 * 块级层样式（UI-SPEC GFM 表格）：真 <table> 边框 / 表头底色 / 单元格内边距。
 *
 * 取色复用 theme.css 的 --cm-table-border / --cm-table-header-bg（亮暗双套，在册），
 * 内边距纵 7px / 横 13px（对标 Typora/Obsidian）；**永不硬编码色值**（highlightTheme.ts 纪律）。
 *
 * 换行收口（TABLE-RENDER-DIAG 根因二）：td/th 物理嵌在主 `.cm-content` 子树内，会经 descendant
 * 组合子继承 lineWrapping 注入的 `white-space:break-spaces` + `overflow-wrap:anywhere` ——
 * 与 `table-layout:auto` 的最小宽算法冲突，把空/短单元格坍缩成「最宽单字符」宽（CDP 实测 ~25px
 * 小格子 root cause）。此处显式把单元格换行属性重置为表格语义：`white-space:normal` +
 * `overflow-wrap:break-word` + `word-break:normal`，并给 `max-width` 让长文本在版心内换行不撑破。
 */
const tableTheme = EditorView.theme({
  // 相邻表格分隔空行（任务一）：两表间 GFM 强制保留的单空行——把行盒高度坍缩为 0（行高/字号/上下间距全清零），
  // 不再占可见行高；两表之间的块间距改由表格自身 margin（下方 .cm-ink-table-wrap 的 0.25em 上下边距合成）提供，
  // 视觉上两表干净分开、无突兀空白行。doc 空行原样保留（守 GFM 真相源）；仅命中两表间单空行，普通段落空行不受影响。
  '.cm-ink-table-gap': {
    height: '0',
    lineHeight: '0',
    fontSize: '0',
    padding: '0',
    margin: '0',
    overflow: 'hidden',
  },
  // wrap：承绝对定位的悬浮工具条（§5 入口 a）；relative + inline-block 贴合表格尺寸。
  '.cm-ink-table-wrap': {
    position: 'relative',
    display: 'inline-block',
    maxWidth: '100%',
    margin: '0.25em 0',
  },
  '.cm-ink-table': {
    borderCollapse: 'collapse',
    border: '1px solid var(--cm-table-border)',
    // 整表不超版心：宽度据内容自适应，封顶 100% 容器宽（长文本经单元格 max-width 换行收口）。
    maxWidth: '100%',
  },
  '.cm-ink-table th, .cm-ink-table td': {
    border: '1px solid var(--cm-table-border)',
    padding: '7px 13px',
    // 纵向顶对齐：换行多行时单元格内容从上沿起，行间不被 middle 拉散（对标 Typora）。
    verticalAlign: 'top',
    textAlign: 'left',
    // 换行收口（修小格子 + 自动换行，覆盖继承自 lineWrapping 的 break-spaces/anywhere）：
    whiteSpace: 'normal',
    overflowWrap: 'break-word',
    wordBreak: 'normal',
    // 单元格最小宽（对照 Zettlr table-editor `td/th min-width:96px` 的成熟实现，根治「空/短内容塌成
    // 小方块」——CDP 实测：无 min-width 时空 cell 仅 27px，整表挤成一簇小格子，十分难看）。空表格（工具栏
    // 插入的全空模板）每格保 6em≈96px 起，渲染为正常表格盒；有内容时据内容在 6em–24em 间自适应。
    minWidth: '6em',
    // 单元格内容宽上限：短内容据内容自适应（窄），长文本在此宽内换行（不横向撑破表格）。
    maxWidth: '24em',
  },
  '.cm-ink-table th': {
    backgroundColor: 'var(--cm-table-header-bg)',
    fontWeight: '600',
  },
  // 就地编辑中的单元格（方案 B）：清零 td 自身 padding 让嵌套子 EditorView 撑满整格（点单元格任意处都落在
  // 子 contentDOM → 稳获焦点 / 拖拽框选，CDP 实测；padding 由子 .cm-content 补回 —— 与上方 td 同款 7px 13px，
  // 故激活前后单元格盒几何一致、无放大跳变，TABLE-RENDER-DIAG 根因一）。去原生 focus 轮廓、给一圈强调内描边
  // （var(--cm-checkbox-checked) 已在册）提示「此格编辑中」。
  // 选择器须比 `.cm-ink-table td`（特异度 0,1,1）更高，否则 padding 被 td 默认覆盖（CDP 实测 bug）：
  // 用 `.cm-ink-table td.cm-ink-cell-editing`（0,2,1）压过。
  '.cm-ink-table td.cm-ink-cell-editing, .cm-ink-table th.cm-ink-cell-editing': {
    padding: '0',
    outline: 'none',
    boxShadow: 'inset 0 0 0 2px var(--cm-checkbox-checked)',
  },
  // 悬浮工具条（§5）：默认隐藏，hover 表格 / 编辑中显现；浮于表格右上方，弹层底色 + 阴影。
  '.cm-ink-table-toolbar': {
    position: 'absolute',
    top: '-34px',
    right: '0',
    display: 'flex',
    alignItems: 'center',
    gap: '1px',
    padding: '3px',
    borderRadius: '6px',
    border: '1px solid var(--background-modifier-border)',
    backgroundColor: 'var(--background-secondary)',
    boxShadow: 'var(--shadow-popup)',
    opacity: '0',
    visibility: 'hidden',
    transition: 'opacity var(--duration-fast, 120ms) ease',
    zIndex: '5',
  },
  '.cm-ink-table-wrap:hover .cm-ink-table-toolbar, .cm-ink-table-wrap:focus-within .cm-ink-table-toolbar':
    {
      opacity: '1',
      visibility: 'visible',
    },
  '.cm-ink-table-toolbar-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    padding: '0',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
  '.cm-ink-table-toolbar-btn:hover': {
    backgroundColor: 'var(--background-modifier-hover)',
    color: 'var(--text-normal)',
  },
  // 对齐按钮当前态高亮（C）：本列当前对齐对应的按钮以强调色 + 浅底标示（var 已在册，永不硬编色）。
  '.cm-ink-table-toolbar-btn-active': {
    backgroundColor: 'var(--background-modifier-hover)',
    color: 'var(--cm-checkbox-checked)',
  },
  '.cm-ink-table-toolbar-sep': {
    width: '1px',
    height: '16px',
    margin: '0 2px',
    backgroundColor: 'var(--background-modifier-border)',
  },
});

/**
 * ```math 块样式（Phase 5 W1）：块公式居中、上下留白、长公式横向滚动不撑破版心；KaTeX 全局 CSS 的
 * .katex-display margin 收口（防污染编辑器排版）；加载中/空块占位给 min-height 防块高跳动；错误态用
 * var(--color-error)（永不硬编色）。覆盖一律写本主题、加 .cm-ink-math 前缀，绝不改 KaTeX 源 CSS（守升级路径）。
 */
const mathTheme = EditorView.theme({
  '.cm-ink-math': {
    display: 'block',
    margin: '0.5em 0',
    maxWidth: '100%',
    overflowX: 'auto',
    textAlign: 'center',
  },
  '.cm-ink-math .katex-display': { margin: '0' },
  '.cm-ink-math-loading, .cm-ink-math-empty': {
    minHeight: '1.6em',
    color: 'var(--text-faint)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    textAlign: 'left',
    whiteSpace: 'pre-wrap',
  },
  '.cm-ink-math-error': { color: 'var(--color-error)', fontFamily: 'var(--font-mono)' },
});

/**
 * ```latex 块样式（Phase 5 W2，对标 mathTheme）：块公式居中、上下留白、长公式横向滚动。MathJax SVG 输出默认
 * fill=currentColor → 容器设 color:var(--text-normal) 即自动适配亮/暗主题（零额外 JS）；收口 mjx-container 默认
 * margin 防污染编辑器排版；占位/错误态同 mathTheme 纪律（永不硬编色）。
 */
const latexTheme = EditorView.theme({
  '.cm-ink-latex': {
    display: 'block',
    margin: '0.5em 0',
    maxWidth: '100%',
    overflowX: 'auto',
    textAlign: 'center',
    color: 'var(--text-normal)',
  },
  '.cm-ink-latex mjx-container': { margin: '0' },
  '.cm-ink-latex mjx-container svg': { maxWidth: '100%' },
  '.cm-ink-latex-loading, .cm-ink-latex-empty': {
    minHeight: '1.6em',
    color: 'var(--text-faint)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    textAlign: 'left',
    whiteSpace: 'pre-wrap',
  },
  '.cm-ink-latex-error': { color: 'var(--color-error)', fontFamily: 'var(--font-mono)' },
});

/**
 * ```typst 块样式（Phase 5 W3）：块就地渲染 SVG。typst 排版默认黑字（SVG 写死色，非 currentColor），暗色主题下
 * 黑字看不清——W3 用「白纸卡片」兜底（白底圆角，类 PDF 预览），主题色源注入（#set text(fill)）留 W4（需主题变化
 * 监听 + 缓存失效）。SVG 自带页面尺寸，max-width:100% 等比缩到版心、overflow-x 兜底超宽；占位/错误同前纪律。
 */
const typstTheme = EditorView.theme({
  '.cm-ink-typst': {
    display: 'block',
    margin: '0.5em 0',
    maxWidth: '100%',
    overflowX: 'auto',
    // 白纸卡片兜底（typst 默认黑字需亮底；主题集成留 W4）：固定白底是 typst「纸张」语义而非主题色。
    backgroundColor: '#ffffff',
    borderRadius: '6px',
    padding: '0.5em',
  },
  '.cm-ink-typst svg': { maxWidth: '100%', height: 'auto' },
  '.cm-ink-typst-loading, .cm-ink-typst-empty': {
    minHeight: '1.6em',
    color: 'var(--text-faint)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    textAlign: 'left',
    whiteSpace: 'pre-wrap',
    backgroundColor: 'transparent',
  },
  '.cm-ink-typst-error': {
    color: 'var(--color-error)',
    fontFamily: 'var(--font-mono)',
    backgroundColor: 'transparent',
  },
});

/**
 * 公式块悬浮工具栏 + 双栏编辑面板样式（W3，永不硬编色）。工具条隐显复用 tableTheme 同款；双栏面板 grid 2 列
 * （源码 textarea 左 / 实时预览右）。typst 预览黑字白纸兜底（同 typstTheme）。
 */
const formulaEditTheme = EditorView.theme({
  // 就地渲染容器相对定位（承绝对定位工具条）；cursor:pointer + hover 描边暗示「点击进双栏编辑」。
  '.cm-ink-math, .cm-ink-latex, .cm-ink-typst': {
    position: 'relative',
    cursor: 'pointer',
    borderRadius: '4px',
    transition: 'background-color var(--duration-fast, 120ms) ease',
  },
  '.cm-ink-math:hover, .cm-ink-latex:hover, .cm-ink-typst:hover': {
    backgroundColor: 'var(--background-modifier-hover)',
  },
  '.cm-ink-formula-toolbar': {
    // 置公式内右上角（非上方）——上方有 hover 间隙，鼠标移过去即脱离 .cm-ink-math:hover 区、工具栏消失点不到。
    position: 'absolute',
    top: '2px',
    right: '2px',
    display: 'flex',
    gap: '1px',
    padding: '3px',
    borderRadius: '6px',
    border: '1px solid var(--background-modifier-border)',
    backgroundColor: 'var(--background-secondary)',
    boxShadow: 'var(--shadow-popup)',
    opacity: '0',
    visibility: 'hidden',
    transition: 'opacity var(--duration-fast, 120ms) ease',
    zIndex: '5',
  },
  '.cm-ink-math:hover .cm-ink-formula-toolbar, .cm-ink-latex:hover .cm-ink-formula-toolbar, .cm-ink-typst:hover .cm-ink-formula-toolbar':
    { opacity: '1', visibility: 'visible' },
  '.cm-ink-formula-toolbar-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    padding: '0',
    border: 'none',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
  '.cm-ink-formula-toolbar-btn:hover': {
    backgroundColor: 'var(--background-modifier-hover)',
    color: 'var(--text-normal)',
  },
  // ── 双栏编辑面板 ──
  '.cm-ink-formula-edit': {
    display: 'block',
    margin: '0.5em 0',
    border: '1px solid var(--background-modifier-border)',
    borderRadius: '6px',
    overflow: 'hidden',
    backgroundColor: 'var(--background-secondary)',
  },
  '.cm-ink-formula-edit-header': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '3px 10px',
    fontSize: '0.8em',
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--background-modifier-border)',
  },
  '.cm-ink-formula-edit-done': {
    border: '1px solid var(--background-modifier-border)',
    borderRadius: '4px',
    padding: '1px 10px',
    background: 'var(--background-primary)',
    color: 'var(--text-normal)',
    cursor: 'pointer',
    fontSize: '0.95em',
  },
  '.cm-ink-formula-edit-body': {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    minHeight: '3.5em',
  },
  '.cm-ink-formula-edit-src': {
    border: 'none',
    outline: 'none',
    resize: 'none',
    padding: '8px 10px',
    minHeight: '3.5em',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.92em',
    lineHeight: '1.5',
    color: 'var(--text-normal)',
    background: 'var(--background-primary)',
    borderRight: '1px solid var(--background-modifier-border)',
  },
  '.cm-ink-formula-edit-preview': {
    padding: '8px',
    overflow: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cm-ink-formula-ph': { color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontSize: '0.85em' },
  '.cm-ink-formula-err': { color: 'var(--color-error)', fontFamily: 'var(--font-mono)', fontSize: '0.85em' },
  '.cm-ink-formula-typst-paper': { backgroundColor: '#ffffff', borderRadius: '4px', padding: '0.4em' },
  '.cm-ink-formula-edit-preview .katex-display': { margin: '0' },
  '.cm-ink-formula-edit-preview svg': { maxWidth: '100%' },
});

/**
 * 块级层组合（挂入 livePreviewExtensions）：编辑态（table/formula）+ blockField（decorations provide）+ atomicRanges
 * + 各样式。tableEditState/formulaEditState 须在 blockField 前——buildBlockState 经 state.field 读它们。
 */
export const blockExtensions = [
  tableEditState,
  formulaEditState,
  blockField,
  tableAtomicRanges,
  formulaAtomicRanges,
  tableTheme,
  mathTheme,
  latexTheme,
  typstTheme,
  formulaEditTheme,
];
