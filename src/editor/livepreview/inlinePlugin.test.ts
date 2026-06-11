import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorSelection } from '@codemirror/state';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, dispatchComposition, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { composingGuard } from './composingGuard';
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

describe('inlinePlugin 光标行还原（D-07）', () => {
  it('光标在标题行内时该行标记不再被隐藏（还原）', () => {
    view = lpView('# H1\n\n正文');
    // 光标移到末行：标题被渲染（标记隐藏）。
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    const renderedHidden = collectDecos(view).filter(
      (d) => d.class === 'cm-ink-hidden' && d.from === 0,
    );
    expect(renderedHidden.length).toBeGreaterThan(0);

    // 光标移回标题行内：标记还原（不再隐藏）。
    view.dispatch({ selection: EditorSelection.cursor(2) });
    const revealedHidden = collectDecos(view).filter(
      (d) => d.class === 'cm-ink-hidden' && d.from === 0,
    );
    expect(revealedHidden.length).toBe(0);
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

    // 光标移到第一行（pos 1）：该行 QuoteMark 还原（不隐藏），第二行仍渲染。
    view.dispatch({ selection: EditorSelection.cursor(1) });
    decos = collectDecos(view);
    const firstMarkRevealed = !decos.some(
      (d) => d.from === 0 && (d.class === 'cm-ink-hidden' || d.class === 'cm-ink-quote-mark'),
    );
    expect(firstMarkRevealed).toBe(true);
  });

  it('列表：光标所在项还原标记，其余项保渲染', () => {
    view = lpView('- a\n- b');
    // 光标在第一行（pos 0）：第一项还原，第二项（4-5）保渲染。
    view.dispatch({ selection: EditorSelection.cursor(0) });
    const decos = collectDecos(view);
    // 第二行 ListMark（4-5）仍被处理（渲染）。
    expect(
      decos.some((d) => (d.class === 'cm-ink-list-mark' || d.widget) && d.from === 4),
    ).toBe(true);
    // 第一行 ListMark（0-1）未被处理（还原）。
    expect(
      decos.some((d) => (d.class === 'cm-ink-list-mark' || d.widget) && d.from === 0),
    ).toBe(false);
  });
});

describe('inlinePlugin IME 短路', () => {
  it('compositionstart 后一次 docChanged 不改变 decorations（保旧 RangeSet）', () => {
    // 须含 composingGuard：compositionstart 经其置 isFrozen=true，inlinePlugin update 才短路。
    view = makeTestView('# H1\n\n正文', [
      extensionsForLanguage('markdown'),
      composingGuard,
      inlinePlugin,
    ]);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    const before = view.plugin(inlinePlugin)!.decorations;

    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    // 组合期插入一字：update.docChanged 为 true，但闸门短路 → decorations 引用不变。
    view.dispatch({ changes: { from: view.state.doc.length, insert: '你' } });

    const after = view.plugin(inlinePlugin)!.decorations;
    expect(after).toBe(before);
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
