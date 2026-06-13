import { afterEach, describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { compositionGate } from '../composition';
import { inlinePlugin } from './inlinePlugin';

/**
 * wiki-link 解析器（自研 MarkdownConfig）+ Live Preview 渲染回归门（Phase 4 W2 / LINK-01）。
 *
 * 断言：
 *   1. 解析：[[target#h^b|alias]] 全语法产 WikiLink + WikiLinkMark/Target/Alias 子节点，区间正确；
 *      空 [[]] / 未闭合 / 跨行不成链；不破坏普通 [text](url) 链接。
 *   2. 渲染（非活动行）：[[ ]] | 被 cm-ink-hidden 隐藏；alias 或 target 加 cm-ink-wikilink 链接样式。
 *   3. 活动行：光标所在行显源码（无 cm-ink-wikilink / 无隐藏，Typora 范式）。
 */

let view: EditorView | null = null;
afterEach(() => {
  destroyTestView(view);
  view = null;
});

interface WNode {
  name: string;
  from: number;
  to: number;
  text: string;
}

/** 解析 doc 收集全部 WikiLink* 节点（名 + 区间 + 文本）。 */
function parseWiki(doc: string): WNode[] {
  const state = EditorState.create({ doc, extensions: [extensionsForLanguage('markdown')] });
  ensureSyntaxTree(state, doc.length, 5000);
  const out: WNode[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name.startsWith('WikiLink')) {
        out.push({ name: n.name, from: n.from, to: n.to, text: doc.slice(n.from, n.to) });
      }
    },
  });
  return out;
}

const marks = (nodes: WNode[]): string[] =>
  nodes.filter((n) => n.name === 'WikiLinkMark').map((n) => n.text);
const one = (nodes: WNode[], name: string): WNode | undefined => nodes.find((n) => n.name === name);

describe('wiki-link 解析（用例表）', () => {
  it('[[Note]]：WikiLink + [[ ]] mark + target，无 alias', () => {
    const n = parseWiki('[[Note]]');
    expect(one(n, 'WikiLink')).toMatchObject({ from: 0, to: 8 });
    expect(marks(n)).toEqual(['[[', ']]']);
    expect(one(n, 'WikiLinkTarget')?.text).toBe('Note');
    expect(one(n, 'WikiLinkAlias')).toBeUndefined();
  });

  it('[[Note|Display]]：target + | mark + alias', () => {
    const n = parseWiki('[[Note|Display]]');
    expect(one(n, 'WikiLinkTarget')?.text).toBe('Note');
    expect(one(n, 'WikiLinkAlias')?.text).toBe('Display');
    expect(marks(n)).toEqual(['[[', '|', ']]']);
  });

  it('[[a/b#sec^id|disp]]：全语法（target 含 #heading^block，alias 分离）', () => {
    const n = parseWiki('[[a/b#sec^id|disp]]');
    expect(one(n, 'WikiLinkTarget')?.text).toBe('a/b#sec^id');
    expect(one(n, 'WikiLinkAlias')?.text).toBe('disp');
  });

  it('中文目标与别名', () => {
    const n = parseWiki('[[笔记/中文页|显示名]]');
    expect(one(n, 'WikiLinkTarget')?.text).toBe('笔记/中文页');
    expect(one(n, 'WikiLinkAlias')?.text).toBe('显示名');
  });

  it('空 [[]] / 未闭合 [[x 不成链', () => {
    expect(parseWiki('[[]]').filter((x) => x.name === 'WikiLink')).toHaveLength(0);
    expect(parseWiki('[[unclosed text').filter((x) => x.name === 'WikiLink')).toHaveLength(0);
  });

  it('跨行不成链；相邻两行各成一链', () => {
    expect(parseWiki('[[a\nb]]').filter((x) => x.name === 'WikiLink')).toHaveLength(0);
    const two = parseWiki('[[a]]\n[[b]]').filter((x) => x.name === 'WikiLink');
    expect(two).toHaveLength(2);
  });

  it('不破坏普通 [text](url) 链接（[[ 先于 Link 解析，单 [ 交回默认）', () => {
    const state = EditorState.create({
      doc: '[link](http://x.com) 和 [[wiki]]',
      extensions: [extensionsForLanguage('markdown')],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const names = new Set<string>();
    syntaxTree(state).iterate({ enter: (n) => void names.add(n.name) });
    expect(names.has('Link')).toBe(true); // 普通链接仍解析。
    expect(names.has('WikiLink')).toBe(true); // wiki-link 共存。
  });
});

/** markdown + inlinePlugin + 冻结门 view。 */
function lpView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown'), inlinePlugin, compositionGate]);
}

/** 收集行内装饰 (from,to,class)。 */
function collectDecos(v: EditorView): Array<{ from: number; to: number; cls?: string }> {
  const set = v.plugin(inlinePlugin)!.decorations;
  const out: Array<{ from: number; to: number; cls?: string }> = [];
  const iter = set.iter();
  while (iter.value) {
    out.push({ from: iter.from, to: iter.to, cls: (iter.value.spec as { class?: string }).class });
    iter.next();
  }
  return out;
}

describe('wiki-link Live Preview 渲染', () => {
  // doc: line1 "x"[0,1] \n line2 "[[Note]]"[2,10] \n line3 "y"[11,12]
  it('非活动行：[[ ]] 隐藏、target 加 cm-ink-wikilink', () => {
    view = lpView('x\n[[Note]]\ny');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) }); // 光标 line3，wiki 行非活动
    const decos = collectDecos(view);
    const hidden = decos.filter((d) => d.cls === 'cm-ink-hidden');
    expect(hidden).toContainEqual({ from: 2, to: 4, cls: 'cm-ink-hidden' }); // [[
    expect(hidden).toContainEqual({ from: 8, to: 10, cls: 'cm-ink-hidden' }); // ]]
    expect(decos).toContainEqual({ from: 4, to: 8, cls: 'cm-ink-wikilink' }); // Note
  });

  it('别名：显 alias、隐 target/[[/|/]]', () => {
    view = lpView('x\n[[Note|Disp]]\ny');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    const decos = collectDecos(view);
    const wl = decos.find((d) => d.cls === 'cm-ink-wikilink')!;
    expect(view.state.doc.sliceString(wl.from, wl.to)).toBe('Disp'); // 展示别名
    // target "Note" 被隐藏（含在 cm-ink-hidden 中）。
    const hidden = decos.filter((d) => d.cls === 'cm-ink-hidden');
    const doc = view.state.doc;
    expect(hidden.some((h) => doc.sliceString(h.from, h.to) === 'Note')).toBe(true);
  });

  it('活动行：光标所在 wiki-link 行显源码（无 wikilink/隐藏装饰）', () => {
    view = lpView('x\n[[Note]]\ny');
    view.dispatch({ selection: EditorSelection.cursor(4) }); // 光标进 wiki 行（line2）
    const decos = collectDecos(view).filter((d) => d.from >= 2 && d.to <= 10);
    expect(decos.some((d) => d.cls === 'cm-ink-wikilink')).toBe(false);
    expect(decos.some((d) => d.cls === 'cm-ink-hidden')).toBe(false);
  });
});
