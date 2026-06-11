import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { BLOCK_REPLACE } from './nodeNames';
import { cursorInRange } from './revealLine';
import { isFrozenState, refreshLivePreview } from './composingGuard';
import { TableWidget } from './widgets/TableWidget';

/**
 * 块级层 StateField（EDIT-03 / RESEARCH Pattern 2 + 4 / Pitfall 3，三层范式块级支柱）。
 *
 * 职责：对 GFM 表格（BLOCK_REPLACE 节点）整块替换为 TableWidget——
 *   - 光标不在块内 → `Decoration.replace({ widget: new TableWidget(text), block: true })`（渲染真表格）；
 *   - 光标在块内 → 不替换（整块还原源码 Markdown，D-06 原子块级）。
 *
 * 块级 replace **必须**从 StateField 经 `provide(EditorView.decorations.from)` 提供——官方约束：
 * 改变文档块结构的 block-replacing 装饰不得从 ViewPlugin 给（RESEARCH Pitfall 3）。
 *
 * atomicRanges（Pattern 4）：`tableAtomicRanges` 喂同一替换 RangeSet，使键盘 moveByChar/Backspace
 * 把表格 widget 当原子跳过（光标不卡进 widget；进块经整块还原退回可编辑源码）。
 *
 * IME 闸门（Pitfall 1）：StateField update 内只有 transaction/state、拿不到 view，故不能查
 * WeakMap——改查 `isFrozenState(tr.state)`（composingGuard 经 setFrozen effect 镜像入 frozenField）。
 * 组合期保旧 DecorationSet（绝不重算），compositionend 的 refreshLivePreview effect 触发一次重建。
 *
 * 与行内层（ViewPlugin）共存于 livePreviewExtensions——CM6 自动合并多个 decorations facet 输入
 * （行内 mark/line 装饰 + 块级 replace 装饰 range 不重叠，无冲突，Pattern 3）。
 */

/**
 * 构建块级替换装饰集（整文档迭代——块级原子块跨多行、非视口局部，须全文判定）。
 *
 * 对每个 BLOCK_REPLACE 节点：光标在块内则跳过（整块还原 D-06），否则加 block replace 装饰。
 * 同源 TableWidget eq 复用 DOM（防闪烁）。RangeSetBuilder 按位置序 O(n) 构建。
 */
function buildBlockDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (!BLOCK_REPLACE.has(node.name)) return undefined;
      // 光标在块内 → 整块还原源码（不替换），并跳过子树。
      if (cursorInRange(state, node.from, node.to)) return false;
      const text = state.doc.sliceString(node.from, node.to);
      builder.add(
        node.from,
        node.to,
        Decoration.replace({ widget: new TableWidget(text), block: true }),
      );
      return false; // 块级节点子树无需再迭代。
    },
  });
  return builder.finish();
}

/**
 * 块级层 StateField：持块级替换 DecorationSet，经 provide(EditorView.decorations.from) 提供。
 *
 * update：组合期（isFrozenState）保旧集；否则 doc 变 / 选区变 / refreshLivePreview effect 时重算。
 * 选区变化驱动「光标进块 ↔ 出块」的整块还原切换。
 */
export const blockField = StateField.define<DecorationSet>({
  create: (state) => buildBlockDecorations(state),
  update(deco, tr) {
    // IME 闸门：组合期保旧 RangeSet（块级 StateField 无 view，查 state 级 frozenField）。
    if (isFrozenState(tr.state)) return deco;
    const refreshed = tr.effects.some((e) => e.is(refreshLivePreview));
    if (tr.docChanged || tr.selection || refreshed) {
      return buildBlockDecorations(tr.state);
    }
    return deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * 表格 atomicRanges（Pattern 4）：喂 blockField 的替换 RangeSet。
 *
 * 键盘光标移动（moveByChar/moveVertically/Backspace）把表格 widget range 当原子跳过；
 * programmatic selection（view.dispatch({selection})）不受约束（RESEARCH Pattern 4 注意）。
 */
export const tableAtomicRanges = EditorView.atomicRanges.of((view) => view.state.field(blockField));

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
