import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { HIDE_MARK, REVEALABLE, headingLevel } from './nodeNames';
import { isFrozen, refreshLivePreview } from './composingGuard';
import { cursorInRange } from './revealLine';

/**
 * 行内层 ViewPlugin（EDIT-03 / RESEARCH Pattern 1，三层范式的行内脊柱）。
 *
 * 职责：
 *   - 渲染态：标题 H1-H6 行得字号 class（cm-ink-hN，保字号字重 600），行内标记（HeaderMark/
 *     EmphasisMark/...）用 Decoration.mark({class:'cm-ink-hidden'}) 隐藏字符——**绝不改 doc**（真相源不变 T-03-06）。
 *   - 光标行还原（D-07）：光标落在 REVEALABLE 元素 range 内 → 跳过其内部标记隐藏（return false），
 *     标记字符显出但字号/字重/行高不变（显标记保排版，零位移）。
 *   - IME 闸门：update() 首行 `if (u.view.composing || isFrozen(u.view)) return;`——组合期保旧 RangeSet，
 *     绝不重算（接 composingGuard，EDIT-06 最高风险件）；compositionend 后由 refreshLivePreview 触发一次重建。
 *   - 性能纪律：仅 view.visibleRanges 内经 RangeSetBuilder 构建，视口外不迭代（10 万字 < 16ms）。
 *
 * 本 plan 行内层覆盖标题 + 加粗 + 斜体（证明 ≥1 元素 + 光标行还原，建立范式）；删除线 / 行内代码 /
 * 列表 / 引用 / 链接 / `<u>` / 水平线在 Plan 06 按同范式追加（节点名已在 nodeNames 预登记，前向兼容扩展点 2）。
 *
 * 样式经 EditorView.theme() 消费 var(--cm-*)，**永不硬编色值**（highlightTheme.ts 纪律）。
 */

/** 标记字符隐藏装饰：CSS 收宽到 0 并不可见（盒模型保旧，切换可见性零位移；非删除 doc）。 */
const HIDDEN_MARK = Decoration.mark({ class: 'cm-ink-hidden' });

/** 标题行字号装饰缓存（cm-ink-h1..6 行级 class），按级别复用，避免每次构建新建 Decoration。 */
const HEADING_LINE: Record<number, Decoration> = {
  1: Decoration.line({ class: 'cm-ink-h1' }),
  2: Decoration.line({ class: 'cm-ink-h2' }),
  3: Decoration.line({ class: 'cm-ink-h3' }),
  4: Decoration.line({ class: 'cm-ink-h4' }),
  5: Decoration.line({ class: 'cm-ink-h5' }),
  6: Decoration.line({ class: 'cm-ink-h6' }),
};

/**
 * 构建可视区行内装饰（仅 view.visibleRanges，RangeSetBuilder 按位置序 O(n)）。
 *
 * 两遍语义但单遍迭代：先按位置序把「标题行级装饰」与「标记隐藏装饰」按起点排好。
 * RangeSetBuilder 要求严格升序 add——标题行级装饰（point at line.from）须先于该行任何 mark add，
 * 故在进入 ATXHeadingN 节点时即时 add 行级装饰（line.from 必 ≤ 其内 HeaderMark.from）。
 */
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  // 已 add 行级装饰的行号去重（同一标题行只 add 一次 line 装饰）。
  const headedLines = new Set<number>();

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        // 光标落在可还原元素内 → 整个子树跳过（return false）：显标记保排版（D-07）。
        if (REVEALABLE.has(node.name) && cursorInRange(state, node.from, node.to)) {
          return false;
        }
        // 标题元素：给所在行加字号 class（行级，保字号字重；不替换文本）。
        const level = headingLevel(node.name);
        if (level > 0) {
          const line = state.doc.lineAt(node.from);
          if (!headedLines.has(line.number)) {
            headedLines.add(line.number);
            builder.add(line.from, line.from, HEADING_LINE[level]);
          }
          return undefined;
        }
        // 标记字符节点：隐藏其字符（装饰，不改 doc）。
        if (HIDE_MARK.has(node.name) && node.to > node.from) {
          builder.add(node.from, node.to, HIDDEN_MARK);
        }
        return undefined;
      },
    });
  }
  return builder.finish();
}

/**
 * 行内装饰样式：标题字号阶梯（UI-SPEC Typography，相对正文 em 倍率，保 600）+ 标记隐藏。
 *
 * 取色复用既有 --cm-heading / --cm-strong / --cm-emphasis（highlightTheme.ts 在册），本 theme 不引硬编色。
 * cm-ink-hidden 用 font-size:0 收宽标记字符（盒模型不撑高，切换可见性零位移——「不跳契约」）。
 */
const inlineTheme = EditorView.theme({
  '.cm-ink-hidden': { fontSize: '0', letterSpacing: '0' },
  '.cm-ink-h1': { fontSize: '1.802em', fontWeight: '600', color: 'var(--cm-heading)' },
  '.cm-ink-h2': { fontSize: '1.602em', fontWeight: '600', color: 'var(--cm-heading)' },
  '.cm-ink-h3': { fontSize: '1.424em', fontWeight: '600', color: 'var(--cm-heading)' },
  '.cm-ink-h4': { fontSize: '1.266em', fontWeight: '600', color: 'var(--cm-heading)' },
  '.cm-ink-h5': { fontSize: '1.125em', fontWeight: '600', color: 'var(--cm-heading)' },
  '.cm-ink-h6': { fontSize: '1em', fontWeight: '600', color: 'var(--cm-heading)' },
});

/** 行内层 ViewPlugin 类：持 decorations，update 接 IME 闸门 + 仅相关变化重算。 */
class InlinePluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(u: ViewUpdate): void {
    // IME 闸门（EDIT-06）：组合期保旧 RangeSet，绝不重算（view.composing 残留 true 由 isFrozen 兜底双判）。
    if (u.view.composing || isFrozen(u.view)) return;
    // 仅文档/视口/选区变化时重算（选区变化驱动光标行还原）；refreshLivePreview effect 亦触发一次重建。
    const refreshed = u.transactions.some((tr) =>
      tr.effects.some((e) => e.is(refreshLivePreview)),
    );
    if (u.docChanged || u.viewportChanged || u.selectionSet || refreshed) {
      this.decorations = buildDecorations(u.view);
    }
  }
}

/**
 * 行内层 ViewPlugin（挂入 livePreviewExtensions）：暴露 decorations facet + 样式 theme。
 */
export const inlinePlugin = ViewPlugin.fromClass(InlinePluginValue, {
  decorations: (v) => v.decorations,
  provide: () => inlineTheme,
});
