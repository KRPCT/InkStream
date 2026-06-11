import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import {
  destroyTestView,
  dispatchComposition,
  makeTestView,
  mockComposing,
} from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { composingGuard, refreshLivePreview } from './composingGuard';
import { inlinePlugin } from './inlinePlugin';

/**
 * 行内层 ViewPlugin 回归门（EDIT-03 / RESEARCH Pattern 1）。
 *
 * 断言四件事：
 *   1. 渲染态：`# H1` 标记 `# ` 被隐藏装饰（cm-ink-hidden）+ 标题行得字号 class（cm-ink-h1）；
 *   2. 光标行还原：光标移入标题行后，该行标记不再被隐藏（return false 还原，D-07）；
 *   3. IME 短路：compositionstart 后一次 docChanged 不改变 plugin.decorations（保旧 RangeSet）；
 *   4. 性能纪律 + 无硬编码色：源文件含 visibleRanges/RangeSetBuilder/composing，无 # 十六进制色。
 */

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

/** 用 markdown(GFM) + inlinePlugin 构建 view。 */
function lpView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), inlinePlugin]);
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

describe('inlinePlugin 光标行淡显（D-07 / UAT #4）', () => {
  it('光标在标题行内时该行标记由隐藏转淡显（cm-ink-mark-faint，非 hidden、非裸）', () => {
    view = lpView('# H1\n\n正文');
    // 光标移到末行：标题被渲染（标记隐藏 cm-ink-hidden）。
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    const rendered = collectDecos(view).filter((d) => d.from === 0);
    expect(rendered.some((d) => d.class === 'cm-ink-hidden')).toBe(true);
    expect(rendered.some((d) => d.class === 'cm-ink-mark-faint')).toBe(false);

    // 光标移回标题行内：标记淡显（cm-ink-mark-faint），不再硬隐藏，也非无装饰裸还原。
    view.dispatch({ selection: EditorSelection.cursor(2) });
    const revealed = collectDecos(view).filter((d) => d.from === 0);
    expect(revealed.some((d) => d.class === 'cm-ink-hidden')).toBe(false);
    expect(revealed.some((d) => d.class === 'cm-ink-mark-faint')).toBe(true);
  });

  it('光标在 `**b**` 行内：两侧 `**` 由隐藏转淡显（满宽淡显，非消失）', () => {
    view = lpView('**b**\n\n尾');
    // 光标在末行：渲染态两个 EmphasisMark 隐藏。
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    expect(collectDecos(view).filter((d) => d.class === 'cm-ink-hidden').length).toBeGreaterThanOrEqual(2);

    // 光标移入加粗元素内（pos 2）：两侧 `**` 转淡显。
    view.dispatch({ selection: EditorSelection.cursor(2) });
    const onLine = collectDecos(view);
    const faint = onLine.filter((d) => d.class === 'cm-ink-mark-faint');
    expect(faint.length).toBeGreaterThanOrEqual(2);
    expect(onLine.some((d) => d.class === 'cm-ink-hidden' && d.from < 5)).toBe(false);
  });

  it('嵌套：光标在 `[**x**](u)` 内 → 链接括号 + URL + 内层 `**` 全部淡显（深度栈正确）', () => {
    view = lpView('[**x**](https://x.com)\n\n尾');
    // 光标移入链接内（pos 3，落在内层加粗）：嵌套各层标记均应淡显，无一硬隐藏。
    view.dispatch({ selection: EditorSelection.cursor(3) });
    const decos = collectDecos(view);
    // LinkMark `[`(0-1) + 内层 EmphasisMark `**` + URL 等标记全部 faint。
    expect(decos.some((d) => d.class === 'cm-ink-mark-faint' && d.from === 0)).toBe(true);
    expect(decos.filter((d) => d.class === 'cm-ink-mark-faint').length).toBeGreaterThanOrEqual(4);
    // 该元素内无任何标记仍走 cm-ink-hidden（嵌套全层淡显，无遗漏）。
    expect(decos.some((d) => d.class === 'cm-ink-hidden')).toBe(false);
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

  it('引用块：QuoteMark 隐藏 + 左竖条；逐行还原', () => {
    view = lpView('> q1\n> q2');
    cursorToEnd(view); // 光标在第二行（pos 8 之内），第一行渲染。
    let decos = collectDecos(view);
    // 第一行 QuoteMark（0-1）被隐藏；该引用行得竖条 line class。
    expect(decos.some((d) => d.class === 'cm-ink-quote')).toBe(true);
    // 第一行 QuoteMark 处理（隐藏）。
    const firstMarkHidden = decos.some(
      (d) => d.from === 0 && (d.class === 'cm-ink-hidden' || d.class === 'cm-ink-quote-mark'),
    );
    expect(firstMarkHidden).toBe(true);

    // 光标移到第一行（pos 1）：该行 QuoteMark 转淡显（非硬隐藏、非裸还原），第二行仍渲染。
    view.dispatch({ selection: EditorSelection.cursor(1) });
    decos = collectDecos(view);
    // 不再 cm-ink-hidden / cm-ink-quote-mark（隐藏类）。
    expect(
      decos.some(
        (d) => d.from === 0 && (d.class === 'cm-ink-hidden' || d.class === 'cm-ink-quote-mark'),
      ),
    ).toBe(false);
    // 改走 cm-ink-mark-faint 淡显。
    expect(decos.some((d) => d.from === 0 && d.class === 'cm-ink-mark-faint')).toBe(true);
  });

  it('列表：光标所在项标记淡显（cm-ink-mark-faint），其余项保渲染', () => {
    view = lpView('- a\n- b');
    // 光标在第一行（pos 0）：第一项淡显，第二项（4-5）保渲染。
    view.dispatch({ selection: EditorSelection.cursor(0) });
    const decos = collectDecos(view);
    // 第二行 ListMark（4-5）仍被处理（渲染隐藏）。
    expect(
      decos.some((d) => (d.class === 'cm-ink-list-mark' || d.widget) && d.from === 4),
    ).toBe(true);
    // 第一行 ListMark（0-1）不再走 list-mark 隐藏类，改走淡显。
    expect(
      decos.some((d) => d.class === 'cm-ink-list-mark' && d.from === 0),
    ).toBe(false);
    expect(decos.some((d) => d.class === 'cm-ink-mark-faint' && d.from === 0)).toBe(true);
  });
});

describe('inlinePlugin IME 短路', () => {
  /** 把某 DecorationSet 摊为 (from,to) 数组（位置契约比对用，忽略 spec 引用）。 */
  function flatten(set: { iter: () => { from: number; to: number; value: unknown; next: () => void } }): Array<{ from: number; to: number }> {
    const out: Array<{ from: number; to: number }> = [];
    const it = set.iter();
    while (it.value) {
      out.push({ from: it.from, to: it.to });
      it.next();
    }
    return out;
  }

  it('组合期 docChanged 不重算语法树，但把旧装饰经 changes 映射跟随位移（root cause B 防回归）', () => {
    // 须含 composingGuard：compositionstart 经其置 isFrozen=true，inlinePlugin update 才走冻结分支。
    // 在被装饰内容**之前**插入字符：若返回未映射旧集（旧 bug），装饰位置相对新文档错位 →
    // CM6 findChangedDeco 伪重建合成中 DOM → 吞字。修复后装饰必须 == before.map(changes)（值同、位移）。
    view = makeTestView('正文\n\n# H1', [
      extensionsForLanguage('markdown'),
      composingGuard,
      inlinePlugin,
    ]);
    // 光标置于「正文」行内（非标题行），使标题处于渲染态、其标记被隐藏装饰。
    view.dispatch({ selection: EditorSelection.cursor(0) });
    const before = view.plugin(inlinePlugin)!.decorations;
    const beforeRanges = flatten(before);
    expect(beforeRanges.length).toBeGreaterThan(0); // 标题标记隐藏装饰存在。

    // 期望：旧集经同一 changes 映射后的位置（标题行整体右移 1，标记装饰随之位移）。
    const insertAt = 0; // 在文首插入，位于所有装饰之前 → 全部 +1。
    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    const changes = view.state.changes({ from: insertAt, insert: '你' });
    const expected = flatten(before.map(changes));
    view.dispatch({ changes: { from: insertAt, insert: '你' }, userEvent: 'input.type.compose' });

    const after = view.plugin(inlinePlugin)!.decorations;
    const afterRanges = flatten(after);
    // 装饰条数不变（未重算、未丢失），位置等于映射结果（跟随位移，非未映射旧集）。
    expect(afterRanges).toEqual(expected);
    // 关键反断言：未映射的旧集（旧 bug 行为）与新文档错位，afterRanges 不应等于 beforeRanges。
    expect(afterRanges).not.toEqual(beforeRanges);
  });

  it('compositionend 残留 composing 时 refreshLivePreview 仍强刷重建（CR-01）', () => {
    // 回归 codemirror/dev#1069：compositionend 解冻派发 refreshLivePreview，
    // 但 view.composing 可能残留 true，若先短路则强刷被吞、行内装饰留旧。
    view = makeTestView('# H1\n\n正文', [
      extensionsForLanguage('markdown'),
      composingGuard,
      inlinePlugin,
    ]);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    // 组合期插入一个新标题字符：闸门短路，装饰保旧（不含新行的隐藏标记）。
    mockComposing(view, true);
    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    view.dispatch({ changes: { from: view.state.doc.length, insert: '\n\n## 二级' } });
    const stale = collectDecos(view).filter((d) => d.class === 'cm-ink-h2');
    expect(stale.length).toBe(0); // 组合期未重建：新标题尚无 h2 行级 class。

    // compositionend 派发 refreshLivePreview，但 view.composing 仍残留 true：必须强刷。
    view.dispatch({ effects: refreshLivePreview.of(null) });
    const refreshed = collectDecos(view).filter((d) => d.class === 'cm-ink-h2');
    expect(refreshed.length).toBeGreaterThan(0); // 强刷后新标题得 cm-ink-h2。
  });

  it('refreshLivePreview 越过 isFrozen 冻结态强刷重建（CR-01）', () => {
    view = makeTestView('# H1\n\n正文', [
      extensionsForLanguage('markdown'),
      composingGuard,
      inlinePlugin,
    ]);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    // 冻结态（isFrozen=true）下插入新标题：短路保旧。
    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    view.dispatch({
      changes: { from: view.state.doc.length, insert: '\n\n## 二级' },
      effects: StateEffect.appendConfig.of([]),
    });
    expect(collectDecos(view).filter((d) => d.class === 'cm-ink-h2').length).toBe(0);

    // 仍处冻结态下派发 refreshLivePreview：必须越过 isFrozen 强刷。
    view.dispatch({ effects: refreshLivePreview.of(null) });
    expect(collectDecos(view).filter((d) => d.class === 'cm-ink-h2').length).toBeGreaterThan(0);
  });
});

describe('inlinePlugin 源纪律', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/editor/livepreview/inlinePlugin.ts'), 'utf8');

  it('含 visibleRanges 与 RangeSetBuilder（性能纪律）', () => {
    expect(src).toContain('visibleRanges');
    expect(src).toContain('RangeSetBuilder');
  });

  it('update 含 composing 短路', () => {
    expect(src).toMatch(/composing/);
  });

  it('无硬编码色值（var(--cm-*) 纪律，同 highlightTheme.test.ts:67）', () => {
    expect(src).not.toMatch(/color:\s*['"]#/);
    expect(src).not.toMatch(/['"]#[0-9a-fA-F]{3,8}['"]/);
  });
});
