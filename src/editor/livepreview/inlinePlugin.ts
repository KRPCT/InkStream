import { syntaxTree } from '@codemirror/language';
import { Facet, type Range, RangeSetBuilder } from '@codemirror/state';
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
  INLINE_MATH_CONTENT,
  INLINE_MATH_NODE,
  INLINE_STYLE,
  LINE_REVEAL_MARK,
  TASK_MARKER_NODE,
  URL_NODE,
  WIKI_LINK_ALIAS,
  WIKI_LINK_MARK,
  WIKI_LINK_NODE,
  WIKI_LINK_TARGET,
  headingLevel,
  isOrderedListMark,
} from './nodeNames';
import { HrWidget } from './widgets/HrWidget';
import { InlineMathWidget } from './widgets/InlineMathWidget';
import { type ImageVaultContext, ImageWidget } from './widgets/ImageWidget';
import { ListBulletWidget } from './widgets/ListBulletWidget';
import { TaskCheckboxWidget } from './widgets/TaskCheckboxWidget';
import { isComposing, refreshLivePreview } from '../composition';

/**
 * 行内层 ViewPlugin（EDIT-03 / RESEARCH Pattern 1，三层范式的行内脊柱）。
 *
 * 职责：
 *   - 渲染态：标题 H1-H6 行得字号 class（cm-ink-hN，保字号字重 600），行内标记（HeaderMark/
 *     EmphasisMark/StrikethroughMark/CodeMark/LinkMark/URL/ListMark/QuoteMark/<u> HTMLTag）用
 *     Decoration.mark({class:'cm-ink-hidden'}) 隐藏字符——**绝不改 doc**（真相源不变 T-03-06）；
 *     删除线 line-through / 行内代码等宽底纹 / 链接色 / `<u>` underline 用 Decoration.mark 加内容样式；
 *     水平线 HorizontalRule 经 Decoration.replace 换 `<hr>` widget。
 *   - 活动行还原（D-07 / D-06，Typora/Obsidian 级契约 + F4 错位根治）：与主选区（state.selection.main）
 *     相交的行**保留行级排版 line decoration**（标题字号 cm-ink-hN、引用竖条 cm-ink-quote——只加 class、
 *     不改文本、不拆文本节点），但**跳过全部隐藏 mark / replace / widget**。效果 = Typora：光标进标题行整行
 *     保持标题字号、`#` 前缀可见；行高在装饰态/源码态恒定，杜绝 F4 实测的 39px↔27px 塌缩重排（点击错位）。
 *     活动行的**文本节点与 doc 切片逐字节相等且无 replace/mark**——line decoration 只加 class 不动文本，
 *     CM6 findCompositionRange 文本相等闸门不破（中文 IME 重复字/长句合成安全）。非活动行全套 Live Preview 渲染。
 *   - IME（重构设计 §4.4，root cause B）：组合判据收口到统一冻结门，update() 据 isComposing(u.view)
 *     在组合期短路——保旧 RangeSet 不重建（撕合成中的文本节点 DOM = 吞字），docChanged 时 map 跟随位移；
 *     compositionend 后门派发 refreshLivePreview 强刷，恰好重建一次还原渲染态（CR-01）。活动行纯源码契约
 *     与门叠加：重建发生时活动行恒为纯文本节点保住相等闸门。
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

/** 无序列表标记 `-`/`*`/`+` → 真项目符号 `•` widget（replace，非活动行渲染）。 */
const BULLET_REPLACE = Decoration.replace({ widget: new ListBulletWidget() });
/** 列表项行级装饰（悬挂缩进保排版，逐行 D-06；活动行同样保留——只加 class 不改文本）。 */
const LIST_LINE = Decoration.line({ class: 'cm-ink-list-line' });
/** 引用块标记装饰（隐藏 `>` 字符；左竖条由行级 cm-ink-quote 提供）。 */
const QUOTE_MARK = Decoration.mark({ class: 'cm-ink-quote-mark' });
/** 引用块行级装饰（左竖条 + 缩进，逐行 D-06）。 */
const QUOTE_LINE = Decoration.line({ class: 'cm-ink-quote' });
/** wiki-link 展示文本装饰（alias 或 target 加链接样式；结构字符另由 HIDDEN_MARK 隐藏）。 */
const WIKI_LINK_DECO = Decoration.mark({ class: 'cm-ink-wikilink' });

/**
 * 图片 vault 上下文 Facet（WR-07：装饰构建不读全局 store，保 per-view 纯净）。
 *
 * 旧实现在 buildInlineDecorations 内直读全局 store 取活动文档上下文——多 view 共存时所有 view 都读同一
 * 活动文档，渲染态与各自 EditorState 脱钩（per-view 不纯）。改为经 Facet 由宿主（editorState 换装时）按
 * view 注入：每个 EditorState 各持其文档的 vault 上下文，装饰构建只读 view.state.facet，零全局 store 触达。
 * 无注入（测试 / 无 vault）回落 null。
 */
export const imageVaultFacet = Facet.define<ImageVaultContext | null, ImageVaultContext | null>({
  combine: (values) => values[0] ?? null,
});

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
  // 图片 vault 上下文一次取（构建期常量）：经 per-view facet 注入（WR-07），不读全局 store。
  // 本地图相对路径据此解析并断言 vault 内（T-03-19）。
  const imageVault = state.facet(imageVaultFacet);
  // 已 add 行级装饰的行号去重（同一标题/引用/列表行只 add 一次 line 装饰）。
  const headedLines = new Set<number>();
  const quotedLines = new Set<number>();
  const listedLines = new Set<number>();
  // `<u>` 开标签栈：遇闭标签时弹出配对，给中间文本加 underline（A2 自配对）。
  let openUTag: { from: number; to: number } | null = null;

  // 活动行集（EDIT-06 Option 2）：仅据**主选区**（state.selection.main）一次算出 [firstLine,lastLine]。
  // 绑定主 range 而非全部选区——多光标 / 大范围选区不会把整屏行都置空。与此区间相交的任一行**跳过全部
  // 隐藏 mark / replace / widget**（文本节点 == doc 切片，满足 findCompositionRange 文本相等闸门），但**保留
  // 行级 line decoration**（标题字号 / 引用竖条，行高稳定，根治塌缩重排）。
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
        // 活动行（与主选区相交）：保留**行级排版 line decoration**（标题字号 cm-ink-hN / 引用竖条
        // cm-ink-quote）——它们只加 class、不改文本、不拆文本节点，故行高在装饰态/源码态保持一致
        // （Typora 同款：光标进标题行仍是标题字号、# 前缀可见），根治 F4 的 39px↔27px 塌缩重排错位。
        // 但**仍跳过**全部隐藏 mark / replace / widget：活动行的文本节点与 doc 切片逐字节相等且无
        // replace/mark，保住 CM6 findCompositionRange 文本相等闸门（line decoration 不破此契约）。
        const active = isActiveLine(node.from);

        // 标题元素：给所在行加字号 class（行级，保字号字重；不替换文本）。活动行同样保留——line
        // decoration 不改文本、不拆节点，行高稳定。
        const level = headingLevel(node.name);
        if (level > 0) {
          const line = state.doc.lineAt(node.from);
          if (!headedLines.has(line.number)) {
            headedLines.add(line.number);
            ranges.push(HEADING_LINE[level].range(line.from, line.from));
          }
          return undefined;
        }

        // 列表项行级装饰（悬挂缩进）：ListMark 所在行得 cm-ink-list-line（行级，只加 class、不改文本，
        // 行高稳定）。活动行同样保留——与标题/引用行级装饰同纪律，光标进列表项时缩进排版不抖动。
        if (node.name === 'ListMark') {
          const line = state.doc.lineAt(node.from);
          if (!listedLines.has(line.number)) {
            listedLines.add(line.number);
            ranges.push(LIST_LINE.range(line.from, line.from));
          }
          // 非活动行继续往下走 LINE_REVEAL_MARK 分支渲染标记本体；活动行由下方 active 分支跳过。
        }

        // 以下分支均为隐藏 mark / replace / widget：活动行一律跳过（保纯源码 + 相等闸门）。
        if (active) {
          // 但引用行仍保留行级竖条 line decoration（不改文本、不隐 `>`，行盒高度稳定）。
          if (node.name === 'QuoteMark') {
            const line = state.doc.lineAt(node.from);
            if (!quotedLines.has(line.number)) {
              quotedLines.add(line.number);
              ranges.push(QUOTE_LINE.range(line.from, line.from));
            }
          }
          return undefined;
        }

        // wiki-link `[[target#h^b|alias]]`（Phase 4 W2）：整节点在此处理并 return false（不下钻子节点）。
        // 隐 WikiLinkMark（`[[`/`]]`/`|`）；有 alias 则隐 target 显 alias，否则显 target——皆加链接样式。
        // 活动行已在上方 active 分支跳过 → 显 `[[...]]` 源码（Typora 范式，相等闸门不破）。
        if (node.name === WIKI_LINK_NODE) {
          const n = node.node;
          for (const mk of n.getChildren(WIKI_LINK_MARK)) {
            if (mk.to > mk.from) ranges.push(HIDDEN_MARK.range(mk.from, mk.to));
          }
          const alias = n.getChild(WIKI_LINK_ALIAS);
          const target = n.getChild(WIKI_LINK_TARGET);
          if (alias) {
            if (target) ranges.push(HIDDEN_MARK.range(target.from, target.to));
            ranges.push(WIKI_LINK_DECO.range(alias.from, alias.to));
          } else if (target) {
            ranges.push(WIKI_LINK_DECO.range(target.from, target.to));
          }
          return false;
        }

        // 行内公式 `$...$`（FEAT-INLINE-MATH）：整节点 replace 为 InlineMathWidget（活动行由上方 active 分支
        // 跳过 → 显 `$...$` 源码）。整节点替换故 return false（不下钻子节点，避免双装饰）。
        if (node.name === INLINE_MATH_NODE) {
          const content = node.node.getChild(INLINE_MATH_CONTENT);
          const latex = content ? state.doc.sliceString(content.from, content.to) : '';
          ranges.push(
            Decoration.replace({ widget: new InlineMathWidget(latex) }).range(node.from, node.to),
          );
          return false;
        }

        // 水平线：整节点 replace 为 <hr>（活动行由上方 active 分支跳过，此处必非活动行）。
        if (node.name === HR_NODE) {
          ranges.push(HR_REPLACE.range(node.from, node.to));
          return false;
        }

        // 图片 `![](url)`：整节点 replace 为 ImageWidget（本地 asset / 远程 https:）。
        // 活动行由上方 active 分支跳过；整节点替换故 return false（子 URL 不再单隐）。
        // url 取自语法树 URL 子节点而非裸正则（WR-02）：titled `![a](u "t")`、spaced `![a]( u )`
        // 形态正则会把标题/空格并入 url；URL 子节点对全部形态精确给出区间。无 URL 子节点（残缺图）则跳过。
        if (node.name === IMAGE_NODE) {
          const urlNode = node.node.getChild(URL_NODE);
          if (urlNode) {
            const url = state.doc.sliceString(urlNode.from, urlNode.to);
            ranges.push(
              Decoration.replace({ widget: new ImageWidget(url, imageVault) }).range(node.from, node.to),
            );
          }
          return false;
        }

        // 任务复选框 `[ ]`/`[x]`（TaskMarker）：replace 为可点 TaskCheckboxWidget。
        // 活动行由上方 active 分支跳过；checked 据中间字符（from+1）非空格判定。
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
        // 活动行由上方 active 分支接管（引用行保竖条 line decoration、不隐 `>`），此处恒为非活动行。
        if (LINE_REVEAL_MARK.has(node.name)) {
          if (node.name === 'QuoteMark') {
            const line = state.doc.lineAt(node.from);
            if (!quotedLines.has(line.number)) {
              quotedLines.add(line.number);
              ranges.push(QUOTE_LINE.range(line.from, line.from));
            }
            if (node.to > node.from) ranges.push(QUOTE_MARK.range(node.from, node.to));
          } else if (node.to > node.from) {
            // ListMark：有序 `1.`/`2.` 保留数字（有语义可见文本，不替换）；无序 `-`/`*`/`+`
            // replace 为真项目符号 `•` widget（旧 cm-ink-list-mark 隐藏底纹缺 ::before 致符号丢失）。
            const markText = state.doc.sliceString(node.from, node.to);
            if (!isOrderedListMark(markText)) {
              ranges.push(BULLET_REPLACE.range(node.from, node.to));
            }
          }
          return undefined;
        }

        // 标记字符节点：隐藏其字符（装饰，不改 doc）。活动行已在上方 active 分支跳过，此处恒隐藏。
        if (HIDE_MARK.has(node.name) && node.to > node.from) {
          ranges.push(HIDDEN_MARK.range(node.from, node.to));
        }
        // URL 节点（链接 [text](url) 的 url 部分）：隐藏（仅显 text）。
        if (node.name === URL_NODE && node.to > node.from) {
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
  // 标题字阶（Obsidian 默认 major-second 1.125 比例，R5 §1.3 保留不动）+ 标题色去红回正文色
  // （var(--cm-heading) 已在 theme.css 改为 --text-normal，R5 D-2）+ 上下间距。
  //
  // F4-fix 关键：标题上下间距用 **padding** 而非 margin。CM6 的高度图（measureVisibleLineHeights）
  // 以 `.cm-line` 的 getBoundingClientRect().height 记录每行块高——该值含 padding 却**不含 margin**。
  // 旧实现把标题间距放 marginTop/marginBottom 时，渲染 DOM 有这段竖向间隙，但高度图按 border-box
  // 高度记录、漏掉 margin，每经一个标题就少计约 (margin-top+margin-bottom)px → posAtCoords 高度图
  // 与真实几何失配、点击落点随文档向下单调累积下偏（CDP 实测 lineDrift 1~6 行）。改用 padding 后
  // 间距计入 border-box 高度，高度图与渲染几何一致，drift 归零（lineWrapping 下同样成立）。
  '.cm-ink-h1': {
    fontSize: '1.802em',
    fontWeight: '600',
    color: 'var(--cm-heading)',
    paddingTop: 'var(--h-margin-top)',
    paddingBottom: 'var(--h-margin-bottom)',
  },
  '.cm-ink-h2': {
    fontSize: '1.602em',
    fontWeight: '600',
    color: 'var(--cm-heading)',
    paddingTop: 'var(--h-margin-top)',
    paddingBottom: 'var(--h-margin-bottom)',
  },
  '.cm-ink-h3': {
    fontSize: '1.424em',
    fontWeight: '600',
    color: 'var(--cm-heading)',
    paddingTop: 'var(--h-margin-top)',
    paddingBottom: 'var(--h-margin-bottom)',
  },
  '.cm-ink-h4': {
    fontSize: '1.266em',
    fontWeight: '600',
    color: 'var(--cm-heading)',
    paddingTop: 'var(--h-margin-top)',
    paddingBottom: 'var(--h-margin-bottom)',
  },
  '.cm-ink-h5': {
    fontSize: '1.125em',
    fontWeight: '600',
    color: 'var(--cm-heading)',
    paddingTop: 'var(--h-margin-top)',
    paddingBottom: 'var(--h-margin-bottom)',
  },
  '.cm-ink-h6': {
    fontSize: '1em',
    fontWeight: '600',
    color: 'var(--cm-heading)',
    paddingTop: 'var(--h-margin-top)',
    paddingBottom: 'var(--h-margin-bottom)',
  },
  // 删除线：文本 line-through（颜色继承正文）。
  '.cm-ink-strike': { textDecoration: 'line-through' },
  // 行内代码：等宽 + 底纹 + 圆角（消费 var(--cm-inline-code-bg)，永不硬编色）。
  // R5 D-4：修变量名笔误 var(--font-monospace)→var(--font-mono)（行内代码字体此前从未生效）；
  // fontSize 0.9em（中文等宽偏大，缩一档更协调，R5 §3.4）。
  '.cm-ink-code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    backgroundColor: 'var(--cm-inline-code-bg)',
    borderRadius: '4px',
    padding: '0.15em 0.4em',
  },
  // `<u>` 下划线（D-15）。
  '.cm-ink-underline': { textDecoration: 'underline' },
  // 链接：色 var(--cm-link)（隐 url 后仅 text 呈现），默认 cursor:text（手势层切 pointer）。
  // R5 §3.4：加下划线 + 2px 偏移（Obsidian 风，提辨识）。
  '.cm-link': {
    color: 'var(--cm-link)',
    cursor: 'text',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  // wiki-link 展示文本（Phase 4 W2）：复用 var(--cm-link) 链接色 + 下划线（独立 class 供 W3 Ctrl+点击跳转
  // 与未来 vault 内/断链差异着色；永不硬编色）。结构字符 [[ ]] | 由 HIDDEN_MARK 收窄隐藏。
  '.cm-ink-wikilink': {
    color: 'var(--cm-link)',
    cursor: 'text',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  // 行内公式 widget（FEAT-INLINE-MATH）：inline-block 随文流，基线由 KaTeX 自身度量对齐；不另设字号
  // （继承所在文本字号，公式与正文等大）。加载/错误占位用等宽 + faint/error 色（同 mathTheme 纪律，永不硬编色）。
  '.cm-ink-inline-math': { display: 'inline-block', verticalAlign: 'baseline' },
  '.cm-ink-inline-math-loading, .cm-ink-inline-math-empty': {
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-faint)',
  },
  '.cm-ink-inline-math-error': { color: 'var(--color-error)', fontFamily: 'var(--font-mono)' },
  // 无序列表项目符号 widget：渲染可见 •（继承正文色，与正文等宽对齐），右侧留窄间距贴近文字。
  '.cm-ink-bullet': { color: 'var(--text-normal)', marginRight: '0.4em' },
  // 列表项行级：悬挂缩进（首行标记凸出、续行对齐文本起点），消费正文行高，不改文本不抖排版。
  '.cm-ink-list-line': { paddingLeft: '1.4em', textIndent: '-1.4em' },
  // 引用块：行级左竖条 var(--cm-blockquote-border) 4px（对齐 Typora）+ 缩进 + 文字弱化为灰（逐行 D-06，R5 §3.4）。
  '.cm-ink-quote': {
    borderLeft: '4px solid var(--cm-blockquote-border)',
    paddingLeft: '12px',
    color: 'var(--cm-blockquote-fg)',
  },
  '.cm-ink-quote-mark': { fontSize: '0.1px', letterSpacing: '-1ch', color: 'transparent' },
  // 水平线 widget：1px var(--cm-hr) 贯穿 + 上下留白（R5 §3.4：1.5em 留白更足）。
  '.cm-ink-hr': {
    border: 'none',
    borderTop: '1px solid var(--cm-hr)',
    margin: '1.5em 0',
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

/** 行内层 ViewPlugin 类：持 decorations，组合期 freeze+map、非组合期重建（active-line 纯源码契约不变）。 */
class InlinePluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildInlineDecorations(view);
  }

  update(u: ViewUpdate): void {
    // refreshLivePreview（compositionend 解冻后推迟派发的一次强刷）必须**先于** IME 短路判定：
    // compositionend 时 u.view.composing 可能残留 true（codemirror/dev#1069），若先短路则强刷被吞、
    // 装饰停在组合期 map 后的旧集——组合结束须恰好重建一次还原渲染态（CR-01）。
    const refreshed = u.transactions.some((tr) =>
      tr.effects.some((e) => e.is(refreshLivePreview)),
    );

    // IME 冻结门（重构设计 §4.4，root cause B）：组合期（compositionstart→compositionend）绝不调
    // buildInlineDecorations 重建语法树——重建会撕掉正在合成的文本节点 DOM → Chromium 中止 IME（吞字）。
    // 组合判据经门的 isComposing(u.view)（铁律 4 双判：view.composing ‖ frozen，覆盖 composing===0 启动窗 +
    // dev#1069 残留），与块级层 isComposingTr(tr) 同源（CR-01 消除）。docChanged 时**必须把旧 RangeSet 经
    // changes 映射跟随位移**：返回未映射的旧集会让 CM6 findChangedDeco 把插入点后所有 chunk 判为未共享 →
    // 伪 changedRanges → 在合成节点上重建 DOM（同样吞字）。map 仅 O(chunks) 位移，不重算语法树（性能守恒）；
    // refreshed 例外（解冻后的安全强刷，放行重建）。
    if (!refreshed && isComposing(u.view)) {
      if (u.docChanged) this.decorations = this.decorations.map(u.changes);
      // 纯选区变化的组合事务：保持当前装饰不动（不重建、无可 map 的 changes）。
      return;
    }

    // 非组合期：规范重建（活动行契约——零 replace/mark + 可有 line decoration——由 buildInlineDecorations 内部保证）。
    // selectionSet 触发重建使活动行集随主选区移动；refreshLivePreview 强刷亦在此重建一次。
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
