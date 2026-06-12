import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, dispatchComposition, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { inlinePlugin } from './inlinePlugin';
import { compositionGate, refreshLivePreview } from '../composition';

/**
 * 行内层 ViewPlugin 回归门（EDIT-03 / RESEARCH Pattern 1，EDIT-06 Option 2 + F4 错位根治）。
 *
 * 断言：
 *   1. 渲染态（非活动行）：`# H1` 标记 `# ` 被隐藏装饰（cm-ink-hidden）+ 标题行得字号 class（cm-ink-h1）；
 *   2. 活动行契约（F4 修正后精确化）：与主选区相交的行**零 mark/replace/widget**（无 hidden / 无 faint /
 *      无 replace），文本节点与 doc 切片逐字节相等（findCompositionRange 文本相等闸门的硬前提）；但**可有
 *      行级 line decoration**（标题字号 cm-ink-hN / 引用竖条 cm-ink-quote——只加 class、不动文本，行高稳定，
 *      根治 39px↔27px 塌缩重排错位，Typora 同款）。同一元素移出活动行后恢复 hidden + widget 渲染；
 *   3. 规范重建：docChanged / selectionSet 时装饰无条件重建（不再有 IME 冻结/映射闸门——
 *      CM6 6.43.1 内置合成保护，组合期 docChange 照常重建，selectionSet 驱动活动行集随光标移动）；
 *   4. 性能纪律 + 无硬编码色：源文件含 visibleRanges/RangeSetBuilder，无 # 十六进制色。
 *
 * 注：jsdom 不复现真实 IME，本套只锁「活动行零 mark/replace/widget」契约；EDIT-06 真验收为手动
 * Windows+WebView2 拼音测试（咕咕咕 + 长句 + 跨装饰）。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

/** 用 markdown(GFM) + inlinePlugin + compositionGate 构建 view（统一冻结门随附，组合断言依赖）。 */
function lpView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), inlinePlugin, compositionGate]);
}

/** 收集装饰集合的 (from,to,spec) 序列。 */
function collectDecos(
  v: EditorView,
): Array<{ from: number; to: number; class?: string; widget?: boolean }> {
  const set = v.plugin(inlinePlugin)!.decorations;
  const out: Array<{ from: number; to: number; class?: string; widget?: boolean }> = [];
  const iter = set.iter();
  while (iter.value) {
    const spec = iter.value.spec as { class?: string; widget?: unknown } | undefined;
    out.push({
      from: iter.from,
      to: iter.to,
      class: spec?.class,
      widget: spec?.widget != null,
    });
    iter.next();
  }
  return out;
}

/** 把光标移到文末（让目标元素进入渲染态而非还原态）。 */
function cursorToEnd(v: EditorView): void {
  v.dispatch({ selection: EditorSelection.cursor(v.state.doc.length) });
}

describe('inlinePlugin 渲染态', () => {
  it('`# H1` 的 `# ` 标记被隐藏装饰且标题行得字号 class', () => {
    // 光标默认在 0（标题行），故先放到第二行让标题渲染。
    view = lpView('# H1\n\n正文');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    const decos = collectDecos(view);
    const hidden = decos.filter((d) => d.class === 'cm-ink-hidden');
    const headingLine = decos.filter((d) => d.class && /cm-ink-h[1-6]/.test(d.class));

    // HeaderMark `# `（含尾随空格）落在 0-2 区被隐藏。
    expect(hidden.some((d) => d.from === 0)).toBe(true);
    // 标题行得 cm-ink-h1 行级 class。
    expect(headingLine.some((d) => d.class?.includes('cm-ink-h1'))).toBe(true);
  });

  it('`**b**` 两侧 `**` 被隐藏装饰', () => {
    view = lpView('**b**\n\n尾');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    const hidden = collectDecos(view).filter((d) => d.class === 'cm-ink-hidden');
    // 两个 EmphasisMark：起始 `**`(0-2) 与结束 `**`(3-5)。
    expect(hidden.length).toBeGreaterThanOrEqual(2);
  });

  it('doc 不变（标记仅装饰隐藏，绝不改真相源 T-03-06）', () => {
    view = lpView('# H1');
    expect(view.state.doc.toString()).toBe('# H1');
  });
});

describe('inlinePlugin 活动行契约（EDIT-06 Option 2 + F4：零 mark/replace/widget，可有 line decoration）', () => {
  /** 取落在某行 [from,to) 字节区间内的装饰（行级 line 装饰起止相等于 line.from，亦计入）。 */
  function decosOnLine(v: EditorView, lineNo: number): ReturnType<typeof collectDecos> {
    const line = v.state.doc.line(lineNo);
    return collectDecos(v).filter((d) => d.from >= line.from && d.from <= line.to);
  }

  /** 取某行的 mark/replace/widget 装饰（line decoration 起止相等于 line.from，from===to，故排除之）。 */
  function inlineDecosOnLine(v: EditorView, lineNo: number): ReturnType<typeof collectDecos> {
    return decosOnLine(v, lineNo).filter((d) => d.from !== d.to);
  }

  it('光标在 `**bold**` 行 → 该行零 mark/replace/widget（无行级装饰可言，纯源码）；移出后标记隐藏 + 加粗渲染', () => {
    view = lpView('**bold**\n\n尾');
    // 光标移到末行：第一行非活动 → 两侧 `**` 隐藏（cm-ink-hidden），加粗内容渲染。
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    const rendered = decosOnLine(view, 1);
    expect(rendered.filter((d) => d.class === 'cm-ink-hidden').length).toBeGreaterThanOrEqual(2);

    // 光标移回加粗行内（pos 2）：该行无 line decoration，故整行零装饰；绝无残留 faint 类。
    view.dispatch({ selection: EditorSelection.cursor(2) });
    const active = decosOnLine(view, 1);
    expect(active.length).toBe(0);
    expect(active.some((d) => d.class === 'cm-ink-hidden')).toBe(false);
    expect(active.some((d) => d.class === 'cm-ink-mark-faint')).toBe(false);
    expect(active.some((d) => d.widget)).toBe(false);
  });

  it('光标在标题行 → 保留 cm-ink-hN line decoration（行高稳定）但零 mark/replace/widget（`# ` 可见、不隐藏）', () => {
    view = lpView('# H1\n\n正文');
    // 光标在末行：标题行非活动 → 得 cm-ink-h1 + `# ` 隐藏。
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    const rendered = decosOnLine(view, 1);
    expect(rendered.some((d) => d.class?.includes('cm-ink-h1'))).toBe(true);
    expect(rendered.some((d) => d.class === 'cm-ink-hidden')).toBe(true);

    // 光标移回标题行（pos 2，活动）：保留行级字号 class（F4 错位根治），但 `# ` 标记不再隐藏、无任何 mark/replace。
    view.dispatch({ selection: EditorSelection.cursor(2) });
    const active = decosOnLine(view, 1);
    expect(active.some((d) => d.class === 'cm-ink-h1' && d.from === d.to)).toBe(true); // line deco 保留
    expect(inlineDecosOnLine(view, 1).length).toBe(0); // 零 mark/replace/widget
    expect(active.some((d) => d.class === 'cm-ink-hidden')).toBe(false); // `# ` 可见
  });

  it('链接 `[**x**](u)` 行活动 → 零 mark/replace/widget（链接括号/URL/内层 `**` 一律不发，无 faint 残留）', () => {
    view = lpView('[**x**](https://x.com)\n\n尾');
    // 光标移入链接行（pos 3）：该行无 line decoration，整行纯源码。
    view.dispatch({ selection: EditorSelection.cursor(3) });
    const active = decosOnLine(view, 1);
    expect(active.length).toBe(0);
    expect(active.some((d) => d.class === 'cm-ink-mark-faint')).toBe(false);
    expect(active.some((d) => d.class === 'cm-ink-hidden')).toBe(false);
  });

  it('多行选区 → 所有相交行零 mark/replace/widget，标题行仍保 cm-ink-hN line decoration，选区外行仍渲染', () => {
    view = lpView('# H1\n**b**\n## H2\n\n尾');
    // 选区从第 1 行起跨到第 3 行（## H2 内）：第 1-3 行全活动。
    const l1 = view.state.doc.line(1).from;
    const l3 = view.state.doc.line(3).to;
    view.dispatch({ selection: EditorSelection.range(l1, l3) });
    // 三行均零 mark/replace/widget。
    expect(inlineDecosOnLine(view, 1).length).toBe(0);
    expect(inlineDecosOnLine(view, 2).length).toBe(0);
    expect(inlineDecosOnLine(view, 3).length).toBe(0);
    // 但两条标题行（1、3）保留 line decoration（行高稳定）。
    expect(decosOnLine(view, 1).some((d) => d.class === 'cm-ink-h1' && d.from === d.to)).toBe(true);
    expect(decosOnLine(view, 3).some((d) => d.class === 'cm-ink-h2' && d.from === d.to)).toBe(true);
    // 全局无 faint 类残留（FAINT_MARK 已删）。
    expect(collectDecos(view).some((d) => d.class === 'cm-ink-mark-faint')).toBe(false);
  });

  it('同一元素：非活动行隐藏标记 + 渲染，活动行零 mark/replace/widget（对照契约）', () => {
    view = lpView('**a**\n**b**\n\n尾');
    // 光标在第 1 行（pos 1）：第 1 行活动（无 line deco → 零装饰），第 2 行非活动 → `**` 隐藏。
    view.dispatch({ selection: EditorSelection.cursor(1) });
    expect(decosOnLine(view, 1).length).toBe(0);
    expect(decosOnLine(view, 2).filter((d) => d.class === 'cm-ink-hidden').length).toBeGreaterThanOrEqual(2);
  });
});

describe('inlinePlugin D-08 元素集（删除线 / 行内代码 / 链接 / <u> / 水平线）', () => {
  it('删除线 `~~s~~`：`~~` 隐藏 + 文本 line-through 装饰', () => {
    view = lpView('~~s~~\n\n尾');
    cursorToEnd(view);
    const decos = collectDecos(view);
    // 两个 StrikethroughMark（0-2、3-5）被隐藏。
    expect(decos.filter((d) => d.class === 'cm-ink-hidden').length).toBeGreaterThanOrEqual(2);
    // 整 Strikethrough range 得 line-through class。
    expect(decos.some((d) => d.class === 'cm-ink-strike')).toBe(true);
  });

  it('行内代码 `` `code` ``：反引号隐藏 + 底纹 class', () => {
    view = lpView('`code`\n\n尾');
    cursorToEnd(view);
    const decos = collectDecos(view);
    // 两个 CodeMark（0-1、5-6）被隐藏。
    expect(decos.filter((d) => d.class === 'cm-ink-hidden').length).toBeGreaterThanOrEqual(2);
    // InlineCode range 得底纹 class。
    expect(decos.some((d) => d.class === 'cm-ink-code')).toBe(true);
  });

  it('链接 `[text](url)`：text 显（LinkMark/URL 隐）', () => {
    view = lpView('[text](https://x.com)\n\n尾');
    cursorToEnd(view);
    const hidden = collectDecos(view).filter((d) => d.class === 'cm-ink-hidden');
    // LinkMark `[` `]` `(` `)` + URL 均隐藏；text(1-5) 不在隐藏区。
    expect(hidden.some((d) => d.from === 0)).toBe(true); // `[`
    expect(hidden.some((d) => d.from === 7)).toBe(true); // URL 起点
    expect(hidden.some((d) => d.from === 1 && d.to === 5)).toBe(false); // text 不隐
  });

  it('`<u>x</u>`：中间文本得 underline 配对装饰', () => {
    view = lpView('<u>x</u>\n\n尾');
    cursorToEnd(view);
    const decos = collectDecos(view);
    // 开/闭 HTMLTag（0-3、4-8）隐藏；中间文本 x（3-4）得 underline。
    expect(decos.some((d) => d.class === 'cm-ink-underline' && d.from === 3 && d.to === 4)).toBe(
      true,
    );
    // 开闭标签自身隐藏。
    expect(decos.filter((d) => d.class === 'cm-ink-hidden').length).toBeGreaterThanOrEqual(2);
  });

  it('水平线 `---`：replace 为 <hr> widget', () => {
    view = lpView('a\n\n---\n\nb');
    cursorToEnd(view);
    const decos = collectDecos(view);
    // HorizontalRule（3-6）被 replace widget。
    expect(decos.some((d) => d.widget && d.from === 3 && d.to === 6)).toBe(true);
  });

  it('光标在水平线行内时还原（不 replace）', () => {
    view = lpView('a\n\n---\n\nb');
    cursorToEnd(view);
    expect(collectDecos(view).some((d) => d.widget)).toBe(true);
    // 光标移入 `---` 行（pos 4）：还原源码，不 replace。
    view.dispatch({ selection: EditorSelection.cursor(4) });
    expect(collectDecos(view).some((d) => d.widget)).toBe(false);
  });
});

describe('inlinePlugin 重型 widget（图片 / 任务复选框，D-09）', () => {
  it('图片 `![](url)`：整节点 replace 为 widget', () => {
    view = lpView('![](https://x.com/a.png)\n\n尾');
    cursorToEnd(view);
    const decos = collectDecos(view);
    // Image 节点（0-24）被 replace widget。
    expect(decos.some((d) => d.widget && d.from === 0 && d.to === 24)).toBe(true);
  });

  it('光标在图片行内时还原（不 replace）', () => {
    view = lpView('![](https://x.com/a.png)\n\n尾');
    cursorToEnd(view);
    expect(collectDecos(view).some((d) => d.widget && d.from === 0)).toBe(true);
    // 光标移入图片行（pos 2）：还原源码，不 replace。
    view.dispatch({ selection: EditorSelection.cursor(2) });
    expect(collectDecos(view).some((d) => d.widget && d.from === 0)).toBe(false);
  });

  it('任务复选框 `- [ ]`：TaskMarker replace 为 widget', () => {
    view = lpView('- [ ] todo\n- [x] done');
    cursorToEnd(view);
    const decos = collectDecos(view);
    // 第一行 TaskMarker（2-5）被 replace widget。
    expect(decos.some((d) => d.widget && d.from === 2 && d.to === 5)).toBe(true);
  });
});

describe('inlinePlugin 图片 URL 取自语法树（WR-02：titled / spaced 形态正则会误并标题/空格）', () => {
  /** 取首个 ImageWidget 实例（读其 url 验证解析正确）。 */
  function firstImageUrl(v: EditorView): string | undefined {
    const set = v.plugin(inlinePlugin)!.decorations;
    const iter = set.iter();
    while (iter.value) {
      const widget = (iter.value.spec as { widget?: { url?: string } }).widget;
      if (widget && typeof widget.url === 'string') return widget.url;
      iter.next();
    }
    return undefined;
  }

  it('裸 `![](url)`：url 精确', () => {
    view = lpView('![](https://x.com/a.png)\n\n尾');
    cursorToEnd(view);
    expect(firstImageUrl(view)).toBe('https://x.com/a.png');
  });

  it('titled `![a](url "标题")`：url 不含标题（正则旧实现会并入 ` "标题"`）', () => {
    view = lpView('![a](https://x.com/a.png "图说")\n\n尾');
    cursorToEnd(view);
    expect(firstImageUrl(view)).toBe('https://x.com/a.png');
  });

  it('spaced `![a]( url )`：url 不含两侧空格（正则旧实现会并入空格）', () => {
    view = lpView('![a]( https://x.com/a.png )\n\n尾');
    cursorToEnd(view);
    expect(firstImageUrl(view)).toBe('https://x.com/a.png');
  });

  it('本地相对图 `![](img/a.png)`：url 为原始相对路径（widget 内再解析 vault）', () => {
    view = lpView('![](img/a.png)\n\n尾');
    cursorToEnd(view);
    expect(firstImageUrl(view)).toBe('img/a.png');
  });
});

describe('inlinePlugin 列表 / 引用逐行还原（D-06）', () => {
  it('无序列表：ListMark 隐藏 + 渲染项目符号', () => {
    view = lpView('- a\n- b');
    // 光标默认在 0（第一项行）；移到末行让第一项渲染。
    cursorToEnd(view);
    const decos = collectDecos(view);
    // 第一行 ListMark（0-1）被隐藏并替换为项目符号 widget/底纹。
    expect(
      decos.some((d) => (d.class === 'cm-ink-list-mark' || d.widget) && d.from === 0),
    ).toBe(true);
  });

  it('引用块：QuoteMark 隐藏 + 左竖条（非活动行渲染）', () => {
    view = lpView('> q1\n> q2');
    cursorToEnd(view); // 光标在第二行，第一行非活动 → 渲染。
    const decos = collectDecos(view);
    // 第一行得竖条 line class。
    expect(decos.some((d) => d.class === 'cm-ink-quote')).toBe(true);
    // 第一行 QuoteMark（0-1）隐藏。
    expect(
      decos.some(
        (d) => d.from === 0 && (d.class === 'cm-ink-hidden' || d.class === 'cm-ink-quote-mark'),
      ),
    ).toBe(true);
  });

  it('引用块活动行：保留竖条 cm-ink-quote line decoration（行高稳定）但 QuoteMark 不隐藏（`>` 可见、零 mark/replace）', () => {
    view = lpView('> q1\n> q2');
    // 光标在第一行（pos 1）：该行活动 → 保竖条 line 装饰，但 `>` 不再隐藏、无任何 mark/replace。
    view.dispatch({ selection: EditorSelection.cursor(1) });
    const line1 = view.state.doc.line(1);
    const onLine1 = collectDecos(view).filter((d) => d.from >= line1.from && d.from <= line1.to);
    // 竖条 line decoration 保留（F4 错位根治：行高与非活动态一致）。
    expect(onLine1.some((d) => d.class === 'cm-ink-quote' && d.from === d.to)).toBe(true);
    // 零 mark/replace/widget：`>` 可见（QuoteMark 不隐藏）。
    expect(onLine1.filter((d) => d.from !== d.to).length).toBe(0);
    expect(onLine1.some((d) => d.class === 'cm-ink-quote-mark')).toBe(false);
    expect(onLine1.some((d) => d.class === 'cm-ink-mark-faint')).toBe(false);
    // 第二行非活动 → 仍渲染（QuoteMark 隐藏）。
    expect(collectDecos(view).some((d) => d.class === 'cm-ink-quote-mark' || d.class === 'cm-ink-hidden')).toBe(true);
  });

  it('列表：活动行项整行纯源码，其余项保渲染', () => {
    view = lpView('- a\n- b');
    // 光标在第一行（pos 0）：第一项活动纯源码，第二项（4-5）保渲染。
    view.dispatch({ selection: EditorSelection.cursor(0) });
    const decos = collectDecos(view);
    // 第二行 ListMark（4-5）仍被处理（渲染隐藏）。
    expect(
      decos.some((d) => (d.class === 'cm-ink-list-mark' || d.widget) && d.from === 4),
    ).toBe(true);
    // 第一行（活动）整行零装饰：ListMark 既不隐藏也不淡显。
    const line1 = view.state.doc.line(1);
    const onLine1 = decos.filter((d) => d.from >= line1.from && d.from <= line1.to);
    expect(onLine1.length).toBe(0);
    expect(decos.some((d) => d.class === 'cm-ink-mark-faint')).toBe(false);
  });
});

describe('inlinePlugin IME freeze/map（EDIT-06：组合期 map 不重建，compositionend 恰好重建一次）', () => {
  it('组合期 docChanged → 装饰被 MAP（positions 跟随位移，values 不变），绝不重建语法树', () => {
    // 非活动标题行先渲染：把光标移到末行，第一行 `# H1` 得隐藏标记 + cm-ink-h1。
    view = lpView('# H1\n\n正文二');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    const before = collectDecos(view);
    const beforeH1 = before.filter((d) => d.class === 'cm-ink-h1');
    const beforeHidden = before.filter((d) => d.class === 'cm-ink-hidden');
    expect(beforeH1.length).toBeGreaterThan(0);
    expect(beforeHidden.length).toBeGreaterThan(0);

    // 组合期在**文末**（非第一行）插入 2 字：第一行装饰不应重建，只应整体保持（文末插入对其位置无影响）。
    dispatchComposition(view, { phase: 'compositionstart', data: '你好' });
    view.dispatch({
      changes: { from: view.state.doc.length, insert: '你好' },
      userEvent: 'input.type.compose',
    });
    const after = collectDecos(view);

    // 契约：map（非重建）——装饰条目数与每条 (from,to,class) 与 before 完全一致（文末插入不移动前缀装饰）。
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i += 1) {
      expect(after[i]!.from).toBe(before[i]!.from);
      expect(after[i]!.to).toBe(before[i]!.to);
      expect(after[i]!.class).toBe(before[i]!.class);
      expect(after[i]!.widget).toBe(before[i]!.widget);
    }
  });

  it('组合期文首插入 → 装饰 == before.map(changes)（值同、位置经 map 位移），不重建', () => {
    view = lpView('# H1\n\n正文二');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    const before = collectDecos(view);
    const insertLen = 2;

    dispatchComposition(view, { phase: 'compositionstart', data: '甲乙' });
    view.dispatch({ changes: { from: 0, insert: '甲乙' }, userEvent: 'input.type.compose' });
    const after = collectDecos(view);

    // 契约：map（非重建）——条目数不变、每条 class/widget 身份不变。位置经 changes 映射（非裸 +insertLen：
    // 行级 line 装饰锚在 line.from 且 side 使其留在行首，故只断言 from ≥ before，且 hidden mark 确实右移）。
    expect(after.length).toBe(before.length); // 重建会因新非活动行增条目 → 条目数不变即证非重建。
    for (let i = 0; i < before.length; i += 1) {
      expect(after[i]!.class).toBe(before[i]!.class); // values 不变。
      expect(after[i]!.widget).toBe(before[i]!.widget);
      expect(after[i]!.from).toBeGreaterThanOrEqual(before[i]!.from); // 经 map 位移，不会前移。
    }
    // 至少一条内容 mark（如 HeaderMark 隐藏区）右移了 insertLen（证发生了 map 位移而非原地不动）。
    expect(after.some((d, i) => d.from === before[i]!.from + insertLen)).toBe(true);
  });

  it('compositionend 后 refreshLivePreview 强刷恰好重建一次（组合期累积的新结构此刻渲染）', async () => {
    view = lpView('正文\n\n正文二');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    expect(collectDecos(view).some((d) => d.class === 'cm-ink-h1')).toBe(false);

    // 组合期文首插入一个新标题：map 期间不重建，故 cm-ink-h1 尚未出现（旧集只是位移）。
    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    view.dispatch({ changes: { from: 0, insert: '# H1\n\n' }, userEvent: 'input.type.compose' });
    expect(collectDecos(view).some((d) => d.class === 'cm-ink-h1')).toBe(false);

    // compositionend 触发推迟的强刷：flush 微任务后装饰重建一次，新标题得 cm-ink-h1。
    dispatchComposition(view, { phase: 'compositionend', data: '你' });
    await Promise.resolve();
    // 光标移到末行让新标题行非活动 → 渲染其字号 class。
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    expect(collectDecos(view).some((d) => d.class === 'cm-ink-h1')).toBe(true);
  });

  it('refreshLivePreview effect 直接驱动重建（即便无 docChange，绕过组合短路）', () => {
    view = lpView('# H1\n\n正文');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    // 模拟组合残留态：手动派发 refresh effect，装饰层应据此重建（refreshed 先于组合短路判定）。
    view.dispatch({ effects: refreshLivePreview.of(null) });
    expect(collectDecos(view).some((d) => d.class === 'cm-ink-h1')).toBe(true);
  });

  it('非组合期 docChange 照常规范重建（active-line 纯源码契约不变）', () => {
    view = lpView('# H1\n\n正文');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    // 普通（非组合）输入：走 buildInlineDecorations 重建，新二级标题得 cm-ink-h2。
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n\n## 二级' } });
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(collectDecos(view).filter((d) => d.class === 'cm-ink-h2').length).toBeGreaterThan(0);
  });
});

describe('inlinePlugin 规范重建（非组合期：活动行随选区重建）', () => {
  it('selectionSet 驱动活动行集随光标移动（光标移入标题行 → `# ` 标记解隐，但保 cm-ink-h1 line decoration）', () => {
    view = lpView('# H1\n\n正文');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    expect(collectDecos(view).some((d) => d.from === 0 && d.class === 'cm-ink-hidden')).toBe(true);

    // 纯选区移动（无 docChange）：update 据 selectionSet 重建，标题行进入活动集。
    view.dispatch({ selection: EditorSelection.cursor(2) });
    const line1 = view.state.doc.line(1);
    const onLine1 = collectDecos(view).filter((d) => d.from >= line1.from && d.from <= line1.to);
    // 行级字号 class 保留（行高稳定，F4 错位根治），但 `# ` 标记解隐、零 mark/replace/widget。
    expect(onLine1.some((d) => d.class === 'cm-ink-h1' && d.from === d.to)).toBe(true);
    expect(onLine1.filter((d) => d.from !== d.to).length).toBe(0);
    expect(onLine1.some((d) => d.class === 'cm-ink-hidden')).toBe(false);
    expect(onLine1.some((d) => d.class === 'cm-ink-mark-faint')).toBe(false);
  });
});

describe('inlinePlugin 源纪律', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/editor/livepreview/inlinePlugin.ts'), 'utf8');

  it('含 visibleRanges 与 RangeSetBuilder（性能纪律）', () => {
    expect(src).toContain('visibleRanges');
    expect(src).toContain('RangeSetBuilder');
  });

  it('接入统一冻结门（isComposing 短路 + refreshLivePreview 强刷重建，重构设计 §4.4）', () => {
    // 组合期短路据门的 isComposing(u.view)（铁律 4 双判）；compositionend 后 refreshLivePreview 触发重建。
    expect(src).toMatch(/isComposing\(u\.view\)/);
    expect(src).toMatch(/refreshLivePreview/);
    // 判据与强刷 effect 均自统一冻结门 composition.ts 引入（不再各读各的真相源，CR-01）。
    expect(src).toContain("from '../composition'");
    // 组合期 docChanged 时 map 旧集（this.decorations.map(u.changes)）而非重建。
    expect(src).toContain('this.decorations.map(u.changes)');
  });

  it('活动行据主选区计算且跳过 mark/replace/widget（保 line decoration），FAINT_MARK 已删', () => {
    // 据主选区算活动行集 [firstLine,lastLine]；活动行跳过隐藏 mark/replace/widget，但保留行级 line decoration。
    expect(src).toContain('state.selection.main');
    expect(src).toMatch(/isActiveLine/);
    // FAINT_MARK 常量与 cm-ink-mark-faint 主题规则均已删除（不留淡显死码）。
    expect(src).not.toMatch(/const FAINT_MARK/);
    expect(src).not.toMatch(/'\.cm-ink-mark-faint'/);
  });

  it('标记隐藏 CSS 用非退化盒几何（font-size:0.1px，非 font-size:0 反模式）', () => {
    expect(src).toContain("fontSize: '0.1px'");
    expect(src).not.toMatch(/fontSize:\s*'0'/);
  });

  it('无硬编码色值（var(--cm-*) 纪律，同 highlightTheme.test.ts:67）', () => {
    expect(src).not.toMatch(/color:\s*['"]#/);
    expect(src).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/);
  });

  it('图片 URL 取自语法树 URL 子节点而非裸正则（WR-02）', () => {
    // getChild(URL_NODE) 取 URL 子节点区间；旧裸正则 ^!\[...\]\( / \)$ 已删（不再 slice 整节点切 url）。
    expect(src).toContain('getChild(URL_NODE)');
    expect(src).not.toMatch(/replace\(\/\^!\\\[/);
  });

  it('装饰构建不读全局 store，图片 vault 经 per-view facet 注入（WR-07）', () => {
    // buildInlineDecorations 经 state.facet(imageVaultFacet) 取上下文，绝不在构建路径 import/调 store。
    expect(src).toContain('state.facet(imageVaultFacet)');
    expect(src).not.toContain('useVaultStore');
    expect(src).not.toContain('useEditorStore');
  });
});
