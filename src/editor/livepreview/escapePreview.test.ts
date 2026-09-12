import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { dispatchComposition, mockComposing } from '../../test/composition';
import { compositionGate } from '../composition';
import { formatBibliography } from '../cslFormat';
import { extensionsForLanguage } from '../languages';
import { inlinePlugin } from './inlinePlugin';

let view: EditorView | null = null;
afterEach(() => { view?.destroy(); view?.dom.remove(); view = null; });

function mount(body: string, live = true) {
  const mode = new Compartment();
  const doc = `${body}\n\n尾`;
  view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [extensionsForLanguage('markdown'), compositionGate, mode.of(live ? inlinePlugin : [])] }) });
  document.body.appendChild(view.dom);
  return { editor: view, mode };
}

/** Read the rendered text while omitting the same hidden markers as the UI CSS. */
function displayedLine(editor: EditorView, index = 0): string {
  const line = editor.contentDOM.querySelectorAll('.cm-line')[index].cloneNode(true) as HTMLElement;
  for (const marker of line.querySelectorAll('.cm-ink-hidden')) marker.remove();
  return line.textContent ?? '';
}

describe('Markdown escape presentation preserves its source document', () => {
  it('shows literal numbering and type brackets from the actual CSL-to-Markdown formatter', async () => {
    const markdown = await formatBibliography([{
      id: 'paper', 'citation-key': 'paper', type: 'article-journal', title: '试验文章',
      author: [{ family: '张', given: '三' }], 'container-title': '试验期刊', issued: { 'date-parts': [[2024]] }, volume: '2', page: '1-4',
    }], 'gbt7714');
    expect(markdown).toContain('\\[1\\]');
    expect(markdown).toContain('\\[J\\]');
    const { editor } = mount(markdown);
    expect(displayedLine(editor)).toContain('[1]');
    expect(displayedLine(editor)).toContain('[J]');
    expect(displayedLine(editor)).not.toContain('\\[');
    expect(editor.state.doc.toString()).toBe(`${markdown}\n\n尾`);
  });

  it.each([
    ['\\[1\\] 文章\\[J\\]', '[1] 文章[J]'],
    ['\\*literal\\*', '*literal*'],
    ['\\\\[plain]', '\\[plain]'],
    ['C:\\Users\\paper.txt and \\q', 'C:\\Users\\paper.txt and \\q'],
  ])('renders %s using parser-recognized escapes only', (source, expected) => {
    const { editor } = mount(source);
    expect(displayedLine(editor)).toBe(expected);
    expect(editor.state.doc.toString()).toBe(`${source}\n\n尾`);
  });

  it('reveals the exact escape syntax on the active line and hides it again when the cursor leaves', () => {
    const source = '\\[1\\]';
    const { editor } = mount(source);
    editor.dispatch({ selection: { anchor: 2 } });
    expect(displayedLine(editor)).toBe(source);
    expect(editor.contentDOM.querySelector('.cm-line .cm-ink-hidden')).toBeNull();
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });
    expect(displayedLine(editor)).toBe('[1]');
    expect(editor.state.doc.toString()).toBe(`${source}\n\n尾`);
  });

  it('source mode keeps every backslash across a live-preview round trip', () => {
    const source = '\\[1\\]';
    const { editor, mode } = mount(source, false);
    const original = editor.state.doc;
    expect(displayedLine(editor)).toBe(source);
    editor.dispatch({ effects: mode.reconfigure(inlinePlugin) });
    expect(displayedLine(editor)).toBe('[1]');
    editor.dispatch({ effects: mode.reconfigure([]) });
    expect(displayedLine(editor)).toBe(source);
    expect(editor.state.doc).toBe(original);
  });

  it.each(['inline', 'fenced', 'indented'] as const)('does not interpret backslashes inside %s code', (kind) => {
    const source = '\\[1\\]';
    const body = kind === 'inline' ? '`' + source + '`' : kind === 'fenced' ? '```text\n' + source + '\n```' : '    ' + source;
    const { editor } = mount(body);
    expect(displayedLine(editor, kind === 'fenced' ? 1 : 0)).toBe(kind === 'indented' ? '    ' + source : source);
    expect(editor.state.doc.toString()).toBe(`${body}\n\n尾`);
  });

  it('does not hide string escapes in a programming-language document', () => {
    const source = 'value = "\\[1\\]"';
    view = new EditorView({ state: EditorState.create({ doc: `${source}\n\ntail`, selection: { anchor: source.length + 2 }, extensions: [extensionsForLanguage('python'), inlinePlugin] }) });
    document.body.appendChild(view.dom);
    expect(displayedLine(view)).toBe(source);
  });

  it('does not introduce new escape decorations while IME is composing', async () => {
    const { editor } = mount('plain');
    mockComposing(editor, true);
    dispatchComposition(editor, { phase: 'compositionstart' });
    const source = '\\[1\\]';
    editor.dispatch({ changes: { from: 0, to: 5, insert: source }, userEvent: 'input.type.compose' });
    expect(displayedLine(editor)).toBe(source);
    mockComposing(editor, false);
    dispatchComposition(editor, { phase: 'compositionend' });
    await Promise.resolve();
    expect(displayedLine(editor)).toBe('[1]');
    expect(editor.state.doc.toString()).toBe(`${source}\n\n尾`);
  });
});
