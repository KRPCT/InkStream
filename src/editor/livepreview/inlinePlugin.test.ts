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
function collectDecos(v: EditorView): Array<{ from: number; to: number; class?: string }> {
  const set = v.plugin(inlinePlugin)!.decorations;
  const out: Array<{ from: number; to: number; class?: string }> = [];
  const iter = set.iter();
  while (iter.value) {
    out.push({
      from: iter.from,
      to: iter.to,
      class: (iter.value.spec as { class?: string } | undefined)?.class,
    });
    iter.next();
  }
  return out;
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
