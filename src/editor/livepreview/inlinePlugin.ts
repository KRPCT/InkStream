import { syntaxTree } from '@codemirror/language';
import { type Range, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import {
  HIDE_MARK,
  HR_NODE,
  HTML_TAG_NODE,
  INLINE_STYLE,
  LINE_REVEAL_MARK,
  REVEALABLE,
  headingLevel,
} from './nodeNames';
import { isFrozen, refreshLivePreview } from './composingGuard';
import { cursorInRange, isCursorOnLineOf } from './revealLine';
import { HrWidget } from './widgets/HrWidget';

/**
 * 行内层 ViewPlugin（EDIT-03 / RESEARCH Pattern 1，三层范式的行内脊柱）。
 *
 * 职责：
 *   - 渲染态：标题 H1-H6 行得字号 class（cm-ink-hN，保字号字重 600），行内标记（HeaderMark/
 *     EmphasisMark/StrikethroughMark/CodeMark/LinkMark/URL/ListMark/QuoteMark/<u> HTMLTag）用
 *     Decoration.mark({class:'cm-ink-hidden'}) 隐藏字符——**绝不改 doc**（真相源不变 T-03-06）；
 *     删除线 line-through / 行内代码等宽底纹 / 链接色 / `<u>` underline 用 Decoration.mark 加内容样式；
 *     水平线 HorizontalRule 经 Decoration.replace 换 `<hr>` widget。
 *   - 光标行还原（D-07 / D-06）：光标落在 REVEALABLE 元素 range 内 → 跳过其内部标记隐藏（return false），
 *     标记字符显出但排版不变；列表项 / 引用块按「光标所在行」逐行还原（LINE_REVEAL_MARK）。
 *   - IME 闸门：update() 首行 `if (u.view.composing || isFrozen(u.view)) return;`——组合期保旧 RangeSet，
 *     绝不重算（接 composingGuard，EDIT-06 最高风险件）；compositionend 后由 refreshLivePreview 触发一次重建。
 *   - 性能纪律：仅 view.visibleRanges 内迭代 + 构建，视口外不迭代（10 万字 < 16ms）。
 *
 * 样式经 EditorView.theme() 消费 var(--cm-*)，**永不硬编色值**（highlightTheme.ts 纪律）。
 */

/** 标记字符隐藏装饰：CSS 收宽到 0 并不可见（盒模型保旧，切换可见性零位移；非删除 doc）。 */
const HIDDEN_MARK = Decoration.mark({ class: 'cm-ink-hidden' });

/** `<u>` 中间文本下划线装饰（D-15，跨开闭 HTMLTag 自配对区间）。 */
const UNDERLINE_MARK = Decoration.mark({ class: 'cm-ink-underline' });

/** 水平线 replace 装饰（HorizontalRule → <hr> widget）。 */
const HR_REPLACE = Decoration.replace({ widget: new HrWidget() });

/** INLINE_STYLE 节点名 → Decoration.mark 缓存（按 class 复用，避免每次构建新建）。 */
const STYLE_MARK = new Map<string, Decoration>(
  [...INLINE_STYLE].map(([node, cls]) => [node, Decoration.mark({ class: cls })]),
);

/** 标题行字号装饰缓存（cm-ink-h1..6 行级 class），按级别复用，避免每次构建新建 Decoration。 */
const HEADING_LINE: Record<number, Decoration> = {
  1: Decoration.line({ class: 'cm-ink-h1' }),
  2: Decoration.line({ class: 'cm-ink-h2' }),
  3: Decoration.line({ class: 'cm-ink-h3' }),
  4: Decoration.line({ class: 'cm-ink-h4' }),
  5: Decoration.line({ class: 'cm-ink-h5' }),
  6: Decoration.line({ class: 'cm-ink-h6' }),
};

/** 列表项标记的项目符号底纹（隐藏原 `-`/`1.` 后由 ::before 呈现符号）。 */
const LIST_MARK = Decoration.mark({ class: 'cm-ink-list-mark' });
/** 引用块标记装饰（隐藏 `>` 字符；左竖条由行级 cm-ink-quote 提供）。 */
const QUOTE_MARK = Decoration.mark({ class: 'cm-ink-quote-mark' });
/** 引用块行级装饰（左竖条 + 缩进，逐行 D-06）。 */
const QUOTE_LINE = Decoration.line({ class: 'cm-ink-quote' });

/**
 * 构建可视区行内装饰（仅 view.visibleRanges）。
 *
 * 收集到数组后排序再喂 RangeSetBuilder：D-08 元素的「整节点内容样式 mark」与其内部「标记隐藏 mark」
 * 常共享起点（如 Strikethrough[0,5] 与 StrikethroughMark[0,2] 皆起于 0），裸 RangeSetBuilder 的严格
 * 升序约束难直写——故先 push 全部 Range 再按 (from, startSide) 排序，最后顺序 add（语义等价、可读）。
 *
 * 导出供 perf.test.ts 直接测量真实装饰构建耗时（替代 Wave 0 占位迭代）。
 */
export function buildInlineDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  // 已 add 行级装饰的行号去重（同一标题/引用行只 add 一次 line 装饰）。
  const headedLines = new Set<number>();
  const quotedLines = new Set<number>();
  // `<u>` 开标签栈：遇闭标签时弹出配对，给中间文本加 underline（A2 自配对）。
  let openUTag: { from: number; to: number } | null = null;

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
            ranges.push(HEADING_LINE[level].range(line.from, line.from));
          }
          return undefined;
        }

        // 水平线：整节点 replace 为 <hr>（光标在该行时由上方 REVEALABLE 之外的行级判定还原）。
        if (node.name === HR_NODE) {
          if (!isCursorOnLineOf(state, node.from)) {
            ranges.push(HR_REPLACE.range(node.from, node.to));
          }
          return false;
        }

        // 内容样式节点（删除线 line-through / 行内代码底纹）：整节点 range 加样式 mark。
        const styleDeco = STYLE_MARK.get(node.name);
        if (styleDeco) {
          ranges.push(styleDeco.range(node.from, node.to));
          return undefined; // 继续迭代子节点以隐藏其内部 CodeMark/StrikethroughMark。
        }

        // `<u>` 行内 HTML：开/闭 HTMLTag 自配对，中间文本加 underline + 标签隐藏（A2 / D-15）。
        if (node.name === HTML_TAG_NODE) {
          const text = state.doc.sliceString(node.from, node.to);
          if (/^<\s*u\b/i.test(text)) {
            // 开标签：记录待配对。
            openUTag = { from: node.from, to: node.to };
            ranges.push(HIDDEN_MARK.range(node.from, node.to));
          } else if (/^<\/\s*u\b/i.test(text) && openUTag) {
            // 闭标签：中间文本加 underline（开标签 to → 闭标签 from），两标签隐藏。
            if (node.from > openUTag.to) {
              ranges.push(UNDERLINE_MARK.range(openUTag.to, node.from));
            }
            ranges.push(HIDDEN_MARK.range(node.from, node.to));
            openUTag = null;
          }
          return undefined;
        }

        // 逐行还原标记（列表 ListMark / 引用 QuoteMark）：光标所在行还原（不处理），其余行渲染。
        if (LINE_REVEAL_MARK.has(node.name)) {
          if (isCursorOnLineOf(state, node.from)) return undefined; // 该行还原源码。
          if (node.name === 'QuoteMark') {
            const line = state.doc.lineAt(node.from);
            if (!quotedLines.has(line.number)) {
              quotedLines.add(line.number);
              ranges.push(QUOTE_LINE.range(line.from, line.from));
            }
            if (node.to > node.from) ranges.push(QUOTE_MARK.range(node.from, node.to));
          } else {
            // ListMark：隐藏原标记并呈现项目符号/序号（::before）。
            if (node.to > node.from) ranges.push(LIST_MARK.range(node.from, node.to));
          }
          return undefined;
        }

        // 标记字符节点：隐藏其字符（装饰，不改 doc）。
        if (HIDE_MARK.has(node.name) && node.to > node.from) {
          ranges.push(HIDDEN_MARK.range(node.from, node.to));
        }
        // URL 节点（链接 [text](url) 的 url 部分）：隐藏（仅显 text）。
        if (node.name === 'URL' && node.to > node.from) {
          ranges.push(HIDDEN_MARK.range(node.from, node.to));
        }
        return undefined;
      },
    });
  }

  // 排序后顺序喂 RangeSetBuilder（保持升序 add 语义；同起点按 startSide 稳定排序）。
  ranges.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) builder.add(r.from, r.to, r.value);
  return builder.finish();
}

/**
 * 行内装饰样式：标题字号阶梯 + 标记隐藏 + D-08 元素集（删除线 / 行内代码 / 链接 / 列表 / 引用 / <u> / 水平线）。
 *
 * 取色复用既有 --cm-link / --cm-inline-code-bg / --cm-blockquote-border / --cm-hr（theme.css 在册），
 * 本 theme 不引硬编色。cm-ink-hidden 用 font-size:0 收宽标记字符（零位移「不跳契约」）。
 */
const inlineTheme = EditorView.theme({
  '.cm-ink-hidden': { fontSize: '0', letterSpacing: '0' },
  '.cm-ink-h1': { fontSize: '1.802em', fontWeight: '600', color: 'var(--cm-heading)' },
  '.cm-ink-h2': { fontSize: '1.602em', fontWeight: '600', color: 'var(--cm-heading)' },
  '.cm-ink-h3': { fontSize: '1.424em', fontWeight: '600', color: 'var(--cm-heading)' },
  '.cm-ink-h4': { fontSize: '1.266em', fontWeight: '600', color: 'var(--cm-heading)' },
  '.cm-ink-h5': { fontSize: '1.125em', fontWeight: '600', color: 'var(--cm-heading)' },
  '.cm-ink-h6': { fontSize: '1em', fontWeight: '600', color: 'var(--cm-heading)' },
  // 删除线：文本 line-through（颜色继承正文）。
  '.cm-ink-strike': { textDecoration: 'line-through' },
  // 行内代码：等宽 + 底纹 + 圆角（消费 var(--cm-inline-code-bg)，永不硬编色）。
  '.cm-ink-code': {
    fontFamily: 'var(--font-monospace, monospace)',
    backgroundColor: 'var(--cm-inline-code-bg)',
    borderRadius: '4px',
    padding: '0.1em 0.3em',
  },
  // `<u>` 下划线（D-15）。
  '.cm-ink-underline': { textDecoration: 'underline' },
  // 链接：色 var(--cm-link)（隐 url 后仅 text 呈现），默认 cursor:text（手势层切 pointer）。
  '.cm-link': { color: 'var(--cm-link)', cursor: 'text' },
  // 列表项符号：隐原标记后由 ::before 呈现 •（项目符号缩进保排版）。
  '.cm-ink-list-mark': { fontSize: '0', letterSpacing: '0' },
  // 引用块：行级左竖条 var(--cm-blockquote-border) + 缩进（逐行 D-06）。
  '.cm-ink-quote': {
    borderLeft: '3px solid var(--cm-blockquote-border)',
    paddingLeft: '12px',
  },
  '.cm-ink-quote-mark': { fontSize: '0', letterSpacing: '0' },
  // 水平线 widget：1px var(--cm-hr) 贯穿 + 上下留白。
  '.cm-ink-hr': {
    border: 'none',
    borderTop: '1px solid var(--cm-hr)',
    margin: '1em 0',
  },
});

/** 行内层 ViewPlugin 类：持 decorations，update 接 IME 闸门 + 仅相关变化重算。 */
class InlinePluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildInlineDecorations(view);
  }

  update(u: ViewUpdate): void {
    // IME 闸门（EDIT-06）：组合期保旧 RangeSet，绝不重算（view.composing 残留 true 由 isFrozen 兜底双判）。
    if (u.view.composing || isFrozen(u.view)) return;
    // 仅文档/视口/选区变化时重算（选区变化驱动光标行还原）；refreshLivePreview effect 亦触发一次重建。
    const refreshed = u.transactions.some((tr) =>
      tr.effects.some((e) => e.is(refreshLivePreview)),
    );
    if (u.docChanged || u.viewportChanged || u.selectionSet || refreshed) {
      this.decorations = buildInlineDecorations(u.view);
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
