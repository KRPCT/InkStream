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
  REVEALABLE,
  TASK_MARKER_NODE,
  headingLevel,
} from './nodeNames';
import { cursorInRange, isCursorOnLineOf } from './revealLine';
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
 *   - 光标行淡显（D-07 / D-06 / UAT #4，Typora 风）：光标落在 REVEALABLE 元素 range 内 → 不再硬还原
 *     （旧 return false 跳子树满字号满不透明），改为压入还原深度栈并继续迭代子树，内部标记走 FAINT_MARK
 *     淡显（满字形宽 + 仅降不透明度，光标进出该行不跳位）；列表项 / 引用块按「光标所在行」逐行淡显
 *     （LINE_REVEAL_MARK）。嵌套元素（如链接内加粗）用深度栈兜底，全层标记一致淡显。
 *   - IME（EDIT-06，Option 1）：不再自建 composition 冻结闸门——CM6 6.15.3+（本项目 6.43.1）内置
 *     合成范围保护（findCompositionRange），update() 照常无条件重建装饰；组合期的 docChange 事务正常
 *     触发 buildInlineDecorations，CM6 自身保护正在合成的文本节点（codemirror-rich-markdoc / SilverBullet /
 *     Obsidian 同此范式，零 composition 代码）。docChanged 的 React/落盘副作用在 useCodeMirror 内据
 *     `!view.composing` 推迟到上屏提交事务，避免每次候选键击触发同步重活。
 *   - 性能纪律：仅 view.visibleRanges 内迭代 + 构建，视口外不迭代（10 万字 < 16ms）。
 *
 * 样式经 EditorView.theme() 消费 var(--cm-*)，**永不硬编色值**（highlightTheme.ts 纪律）。
 */

/** 标记字符隐藏装饰：CSS 收宽到 0 并不可见（盒模型保旧，切换可见性零位移；非删除 doc）。 */
const HIDDEN_MARK = Decoration.mark({ class: 'cm-ink-hidden' });

/**
 * 标记字符淡显装饰（D-07 Typora 风「显标记保排版」软化版，UAT #4）：光标所在元素/行的标记
 * 不再硬还原（满字号满不透明），而是保留满字形宽度、仅降不透明度（var(--cm-mark-faint-opacity)）。
 * 仅改 opacity 不收宽，故光标进出该行字号/行高不跳（布局稳定，非删除 doc）。
 */
const FAINT_MARK = Decoration.mark({ class: 'cm-ink-mark-faint' });

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
  const ranges: Range<Decoration>[] = [];
  // 图片 vault 上下文一次取（构建期常量）：本地图相对路径据此解析并断言 vault 内（T-03-19）。
  const imageVault = currentImageVault();
  // 已 add 行级装饰的行号去重（同一标题/引用行只 add 一次 line 装饰）。
  const headedLines = new Set<number>();
  const quotedLines = new Set<number>();
  // `<u>` 开标签栈：遇闭标签时弹出配对，给中间文本加 underline（A2 自配对）。
  let openUTag: { from: number; to: number } | null = null;
  // 「光标所在可还原元素」深度栈（UAT #4）：用栈而非单布尔，正确处理嵌套（如链接内加粗
  // `[**x**](u)`）——任一层为活动还原元素时其内部标记走淡显（FAINT）而非隐藏（HIDDEN）。
  // 栈存元素 to 边界；enter 时若命中 REVEALABLE 且光标在内则压栈，leave 越过栈顶 to 时弹出。
  const revealStack: number[] = [];
  const markDeco = (): Decoration => (revealStack.length > 0 ? FAINT_MARK : HIDDEN_MARK);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        // 出栈：离开上一活动还原元素 range 后（当前节点起点越过栈顶 to）弹出失效层。
        while (revealStack.length > 0 && node.from >= revealStack[revealStack.length - 1]) {
          revealStack.pop();
        }
        // 光标落在可还原元素内 → 压栈并继续迭代子树：其内部标记改走淡显（FAINT）保排版（D-07）。
        // 不再 return false 跳子树——标记需淡显而非消失，故须迭代到内部 mark 节点逐个上 FAINT。
        if (REVEALABLE.has(node.name) && cursorInRange(state, node.from, node.to)) {
          revealStack.push(node.to);
          // 标题元素仍需补行级字号 class（落入下方 headingLevel 分支）；继续迭代。
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

        // 图片 `![](url)`：整节点 replace 为 ImageWidget（本地 asset / 远程 https:）。
        // 光标在该行时还原源码（D-07，复用 isCursorOnLineOf）；整节点替换故 return false（子 URL 不再单隐）。
        if (node.name === IMAGE_NODE) {
          if (!isCursorOnLineOf(state, node.from)) {
            const url = state.doc.sliceString(node.from, node.to).replace(/^!\[[^\]]*]\(/, '').replace(/\)$/, '');
            ranges.push(
              Decoration.replace({ widget: new ImageWidget(url, imageVault) }).range(node.from, node.to),
            );
          }
          return false;
        }

        // 任务复选框 `[ ]`/`[x]`（TaskMarker）：replace 为可点 TaskCheckboxWidget。
        // 光标在该行时还原源码（D-07）；checked 据中间字符（from+1）非空格判定。
        if (node.name === TASK_MARKER_NODE) {
          if (!isCursorOnLineOf(state, node.from)) {
            const checked = state.doc.sliceString(node.from + 1, node.from + 2).toLowerCase() === 'x';
            ranges.push(
              Decoration.replace({ widget: new TaskCheckboxWidget(checked, node.from) }).range(
                node.from,
                node.to,
              ),
            );
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

        // 逐行还原标记（列表 ListMark / 引用 QuoteMark）：光标所在行标记淡显（FAINT 保排版），其余行渲染。
        if (LINE_REVEAL_MARK.has(node.name)) {
          // 光标所在行：标记不收宽隐藏，改淡显（满字形宽 + 降不透明度），进出该行不跳位（UAT #4）。
          if (isCursorOnLineOf(state, node.from)) {
            if (node.name === 'QuoteMark') {
              // 引用块左竖条仍逐行呈现（行级装饰非标记隐藏，不影响淡显契约）。
              const line = state.doc.lineAt(node.from);
              if (!quotedLines.has(line.number)) {
                quotedLines.add(line.number);
                ranges.push(QUOTE_LINE.range(line.from, line.from));
              }
            }
            if (node.to > node.from) ranges.push(FAINT_MARK.range(node.from, node.to));
            return undefined;
          }
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

        // 标记字符节点：隐藏其字符（装饰，不改 doc）；若处于活动还原元素内则淡显（FAINT）。
        if (HIDE_MARK.has(node.name) && node.to > node.from) {
          ranges.push(markDeco().range(node.from, node.to));
        }
        // URL 节点（链接 [text](url) 的 url 部分）：隐藏（仅显 text）；活动还原元素内淡显。
        if (node.name === 'URL' && node.to > node.from) {
          ranges.push(markDeco().range(node.from, node.to));
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
  // 光标行标记淡显（UAT #4，Typora 风）：仅降不透明度、保满字形宽——光标进出该行字号/行高不跳。
  '.cm-ink-mark-faint': { opacity: 'var(--cm-mark-faint-opacity)' },
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
    // 规范重建（EDIT-06，Option 1）：不再为 IME 自建冻结/映射闸门——CM6 6.43.1 内置合成范围保护，
    // 组合期 docChange 照常无条件重建（选区变化驱动光标行还原）；CM6 自身保护正在合成的文本节点。
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
