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
  IMAGE_NODE,
  INLINE_STYLE,
  LINE_REVEAL_MARK,
  TASK_MARKER_NODE,
  headingLevel,
} from './nodeNames';
import { HrWidget } from './widgets/HrWidget';
import { type ImageVaultContext, ImageWidget } from './widgets/ImageWidget';
import { TaskCheckboxWidget } from './widgets/TaskCheckboxWidget';
import { useVaultStore } from '../../stores/useVaultStore';
import { useEditorStore } from '../../stores/useEditorStore';

/**
 * 行内层 ViewPlugin（EDIT-03 / RESEARCH Pattern 1，三层范式的行内脊柱）。
 *
 * 职责：
 *   - 渲染态：标题 H1-H6 行得字号 class（cm-ink-hN，保字号字重 600），行内标记（HeaderMark/
 *     EmphasisMark/StrikethroughMark/CodeMark/LinkMark/URL/ListMark/QuoteMark/<u> HTMLTag）用
 *     Decoration.mark({class:'cm-ink-hidden'}) 隐藏字符——**绝不改 doc**（真相源不变 T-03-06）；
 *     删除线 line-through / 行内代码等宽底纹 / 链接色 / `<u>` underline 用 Decoration.mark 加内容样式；
 *     水平线 HorizontalRule 经 Decoration.replace 换 `<hr>` widget。
 *   - 活动行整行还原（D-07 / D-06 / EDIT-06 Option 2，Typora/Obsidian 级契约）：与主选区（state.selection.main）
 *     相交的行（[firstLine,lastLine]）**整行不发任何行内装饰**——既不隐藏标记（HIDDEN/FAINT/list/quote），
 *     也不 inline replace（image/hr/task），该行渲染为纯源码：一个与 doc 切片逐字节相等的文本节点。
 *     这正是 CM6 6.43.1 findCompositionRange 文本相等闸门的硬前提——活动行若被拆成多 span（淡显/隐藏/
 *     widget），相等判定失败，中文 IME 重复字（咕咕咕）与长句合成仍吞字。整行硬跳过取代旧的逐元素
 *     REVEALABLE 还原 / FAINT 淡显 / LINE_REVEAL 逐行还原，三者被本契约统一吸收。非活动行保持全套 Live
 *     Preview 渲染（隐藏标记 + widget）。
 *   - IME（EDIT-06，Option 2 在 Option 1 之上）：不再自建 composition 冻结闸门——CM6 6.15.3+（本项目 6.43.1）
 *     内置合成范围保护（findCompositionRange），update() 照常无条件重建装饰；组合期的 docChange 事务正常
 *     触发 buildInlineDecorations，活动行恒为纯文本节点保住相等闸门，CM6 自身保护正在合成的文本节点。
 *     docChanged 的 React/落盘副作用在 useCodeMirror 内据 `!view.composing` 推迟到上屏提交事务，避免每次
 *     候选键击触发同步重活。
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
 * 取当前图片 widget 的 vault 上下文（vault 根 + 活动文档相对路径），无 vault / 无活动文档时返回 null。
 *
 * 本地图相对路径据「活动文档目录」解析并断言在 vault 根内（ImageWidget.resolveVaultImage，T-03-19）。
 * 经 store getState() 惰性读取（同 editorState.ts 纪律，store 不进装饰构建闭包外的 React 渲染路径）。
 */
function currentImageVault(): ImageVaultContext | null {
  const root = useVaultStore.getState().vault?.root ?? null;
  const docPath = useEditorStore.getState().activePath;
  if (!root || !docPath) return null;
  return { root, docPath };
}

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
  const doc = state.doc;
  const ranges: Range<Decoration>[] = [];
  // 图片 vault 上下文一次取（构建期常量）：本地图相对路径据此解析并断言 vault 内（T-03-19）。
  const imageVault = currentImageVault();
  // 已 add 行级装饰的行号去重（同一标题/引用行只 add 一次 line 装饰）。
  const headedLines = new Set<number>();
  const quotedLines = new Set<number>();
  // `<u>` 开标签栈：遇闭标签时弹出配对，给中间文本加 underline（A2 自配对）。
  let openUTag: { from: number; to: number } | null = null;

  // 活动行集（EDIT-06 Option 2）：仅据**主选区**（state.selection.main）一次算出 [firstLine,lastLine]。
  // 绑定主 range 而非全部选区——多光标 / 大范围选区不会把整屏行都置空。与此区间相交的任一行整行跳过
  // 所有行内装饰，渲染为纯源码文本节点（== doc 切片，满足 findCompositionRange 文本相等闸门）。
  const sel = state.selection.main;
  const firstLine = doc.lineAt(sel.from).number;
  const lastLine = doc.lineAt(sel.to).number;
  const isActiveLine = (pos: number): boolean => {
    const ln = doc.lineAt(pos).number;
    return ln >= firstLine && ln <= lastLine;
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        // 活动行硬跳过（EDIT-06 Option 2，FIRST CHECK）：节点所在行与主选区相交 → 不发任何装饰
        // （无 HIDDEN/FAINT/list/quote 隐藏，无 image/hr/task inline replace，无标题行级 class）。
        // 该行整行保持纯源码：单个与 doc 逐字节相等的文本节点，保住中文 IME 合成相等闸门。
        // 旧的逐元素 REVEALABLE 还原 / FAINT 淡显 / LINE_REVEAL 逐行还原全被本契约吸收。
        if (isActiveLine(node.from)) {
          return undefined; // 继续迭代子树以快速越过，但任何分支都不 push 装饰。
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

        // 水平线：整节点 replace 为 <hr>（活动行还原由顶部整行硬跳过统一接管，此处必非活动行）。
        if (node.name === HR_NODE) {
          ranges.push(HR_REPLACE.range(node.from, node.to));
          return false;
        }

        // 图片 `![](url)`：整节点 replace 为 ImageWidget（本地 asset / 远程 https:）。
        // 活动行还原由顶部整行硬跳过接管；整节点替换故 return false（子 URL 不再单隐）。
        if (node.name === IMAGE_NODE) {
          const url = state.doc.sliceString(node.from, node.to).replace(/^!\[[^\]]*]\(/, '').replace(/\)$/, '');
          ranges.push(
            Decoration.replace({ widget: new ImageWidget(url, imageVault) }).range(node.from, node.to),
          );
          return false;
        }

        // 任务复选框 `[ ]`/`[x]`（TaskMarker）：replace 为可点 TaskCheckboxWidget。
        // 活动行还原由顶部整行硬跳过接管；checked 据中间字符（from+1）非空格判定。
        if (node.name === TASK_MARKER_NODE) {
          const checked = state.doc.sliceString(node.from + 1, node.from + 2).toLowerCase() === 'x';
          ranges.push(
            Decoration.replace({ widget: new TaskCheckboxWidget(checked, node.from) }).range(
              node.from,
              node.to,
            ),
          );
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

        // 逐行还原标记（列表 ListMark / 引用 QuoteMark）：非活动行渲染（隐藏标记 + 竖条/项目符号）。
        // 活动行逐行还原由顶部整行硬跳过统一接管，此处恒为非活动行。
        if (LINE_REVEAL_MARK.has(node.name)) {
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

        // 标记字符节点：隐藏其字符（装饰，不改 doc）。活动行已在顶部整行跳过，此处恒隐藏。
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
 * 本 theme 不引硬编色。标记隐藏用 Obsidian/HyperMD 技法（font-size:0.1px + letter-spacing:-1ch +
 * color:transparent）收窄字符且**保留非退化盒几何**——font-size:0 会让 contentEditable 盒退化，IME
 * 合成锚点 / 光标定位易错位；保 0.1px 高度的盒既视觉不可见又维持可定位盒（零位移「不跳契约」）。
 */
const inlineTheme = EditorView.theme({
  '.cm-ink-hidden': { fontSize: '0.1px', letterSpacing: '-1ch', color: 'transparent' },
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
  '.cm-ink-list-mark': { fontSize: '0.1px', letterSpacing: '-1ch', color: 'transparent' },
  // 引用块：行级左竖条 var(--cm-blockquote-border) + 缩进（逐行 D-06）。
  '.cm-ink-quote': {
    borderLeft: '3px solid var(--cm-blockquote-border)',
    paddingLeft: '12px',
  },
  '.cm-ink-quote-mark': { fontSize: '0.1px', letterSpacing: '-1ch', color: 'transparent' },
  // 水平线 widget：1px var(--cm-hr) 贯穿 + 上下留白。
  '.cm-ink-hr': {
    border: 'none',
    borderTop: '1px solid var(--cm-hr)',
    margin: '1em 0',
  },
  // 图片 widget：内容区宽等比缩放（max-width 100%）+ max-height ~60vh，块状呈现。
  '.cm-ink-image': { display: 'inline-block', maxWidth: '100%', verticalAlign: 'top' },
  '.cm-ink-image-img': { maxWidth: '100%', maxHeight: '60vh', display: 'block' },
  // 加载中占位：var(--cm-image-loading-bg) 底纹保占位高（减跳动）。
  '.cm-ink-image-loading': {
    minWidth: '120px',
    minHeight: '80px',
    backgroundColor: 'var(--cm-image-loading-bg)',
  },
  // 失败态：「无法加载图片」+ var(--color-error) 1px 描边。
  '.cm-ink-image-error': {
    border: '1px solid var(--color-error)',
    borderRadius: '4px',
    padding: '0.4em 0.6em',
    color: 'var(--color-error)',
  },
  '.cm-ink-image-error-label': { fontSize: '0.9em' },
  // 任务复选框：可点 input，未勾 var(--cm-table-border) 描边、已勾 var(--cm-checkbox-checked) 填充。
  '.cm-ink-task-checkbox': {
    cursor: 'pointer',
    margin: '0 0.3em 0 0',
    accentColor: 'var(--cm-checkbox-checked)',
  },
});

/** 行内层 ViewPlugin 类：持 decorations，仅文档/视口/选区变化时无条件重算（信赖 CM6 合成保护）。 */
class InlinePluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildInlineDecorations(view);
  }

  update(u: ViewUpdate): void {
    // 规范重建（EDIT-06，Option 2 在 Option 1 之上）：不再为 IME 自建冻结/映射闸门——CM6 6.43.1 内置
    // 合成范围保护，组合期 docChange 照常无条件重建。selectionSet 触发重建使活动行集随主选区移动
    // （新活动行整行还原为纯源码 / 旧活动行恢复渲染），保住正在合成行的文本相等闸门。
    if (u.docChanged || u.viewportChanged || u.selectionSet) {
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
