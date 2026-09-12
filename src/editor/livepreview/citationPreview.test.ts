import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zoteroCslResilient, zoteroSetCredentials } from '../../ipc/zotero';
import type { CslItem } from '../../types/zotero';
import { dispatchComposition, mockComposing } from '../../test/composition';
import { compositionGate } from '../composition';
import { extensionsForLanguage } from '../languages';
import { citationPreview, refreshCitationPreviews } from './citationPreview';

vi.mock('../../ipc/zotero', async (original) => ({
  ...await original<typeof import('../../ipc/zotero')>(), zoteroCslResilient: vi.fn(),
}));

const book = (key: string, author = key): CslItem => ({
  'citation-key': key, type: 'book', title: `Title ${key}`, author: [{ family: author, given: 'Alice' }],
  publisher: 'Publisher', issued: { 'date-parts': [[2024]] },
});
let view: EditorView | null = null;
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.mocked(zoteroCslResilient).mockResolvedValue([book('a', 'AuthorA'), book('b', 'AuthorB')]); });
afterEach(() => { view?.destroy(); view?.dom.remove(); view = null; vi.useRealTimers(); });

function state(source: string, preview: Extension = citationPreview): EditorState {
  const doc = `${source}\n\nTail`;
  return EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [extensionsForLanguage('markdown'), compositionGate, preview] });
}
function mount(source: string, preview: Extension = citationPreview): EditorView {
  view = new EditorView({ state: state(source, preview) });
  document.body.appendChild(view.dom);
  return view;
}
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(130);
  await vi.dynamicImportSettled();
  await Promise.resolve();
}
function rendered(editor: EditorView): string[] {
  return [...editor.contentDOM.querySelectorAll('.cm-ink-citation')].map((element) => element.textContent ?? '');
}

describe('citation preview is a document-scoped presentation of the pinned CSL result', () => {
  it('formats repeated citations across paragraphs without changing the document or resetting numbering', async () => {
    const editor = mount('[@b]\n\n[@a]\n\n[@b]');
    const source = editor.state.doc;
    await settle();
    expect(rendered(editor).map((text) => text.match(/\d+/g))).toEqual([['1'], ['2'], ['1']]);
    expect(editor.state.doc).toBe(source);
    expect(zoteroCslResilient).toHaveBeenCalledTimes(1);
  });

  it('reveals source syntax on the active line without fetching again on cursor movement', async () => {
    const editor = mount('[@b]\n\n[@a]');
    await settle();
    editor.dispatch({ selection: { anchor: 2 } });
    expect(editor.contentDOM.querySelector('.cm-line')?.textContent).toBe('[@b]');
    expect(rendered(editor)).toHaveLength(1);
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });
    expect(rendered(editor)).toHaveLength(2);
    expect(zoteroCslResilient).toHaveBeenCalledTimes(1);
  });

  it('reuses metadata but recomputes global numbering after citation order changes', async () => {
    const editor = mount('[@b]\n\n[@a]\n\n[@b]');
    await settle();
    editor.dispatch({ changes: { from: 0, to: 4, insert: '[@a]' } });
    await settle();
    expect(rendered(editor).map((text) => text.match(/\d+/g))).toEqual([['1'], ['1'], ['2']]);
    expect(zoteroCslResilient).toHaveBeenCalledTimes(1);
  });

  it('changing the document bibliography style updates inline citations from the same metadata', async () => {
    const editor = mount('[@a]\n\n<!-- biblio:apa -->');
    await settle();
    expect(rendered(editor)[0]).toContain('2024');
    const from = editor.state.doc.toString().indexOf('apa');
    editor.dispatch({ changes: { from, to: from + 3, insert: 'vancouver' } });
    await settle();
    expect(rendered(editor)[0].match(/\d+/g)).toEqual(['1']);
    expect(zoteroCslResilient).toHaveBeenCalledTimes(1);
  });

  it('cannot publish an old document response after the EditorView changes documents', async () => {
    let resolveOld!: (items: CslItem[]) => void;
    vi.mocked(zoteroCslResilient).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    const editor = mount('[@a]\n\n<!-- biblio:apa -->');
    await vi.advanceTimersByTimeAsync(130);
    editor.setState(state('[@b]\n\n<!-- biblio:apa -->'));
    await settle();
    expect(rendered(editor)[0]).toContain('AuthorB');
    const current = editor.state.doc;
    resolveOld([book('a', 'OLD ACCOUNT')]);
    await settle();
    expect(editor.state.doc).toBe(current);
    expect(rendered(editor)[0]).not.toContain('OLD ACCOUNT');
  });

  it('clears old account presentation immediately and ignores its late metadata', async () => {
    vi.mocked(zoteroCslResilient).mockResolvedValueOnce([book('a', 'OldAuthor')]);
    const editor = mount('[@a]\n\n<!-- biblio:apa -->');
    await settle();
    expect(rendered(editor)[0]).toContain('OldAuthor');
    let resolveOld!: (items: CslItem[]) => void;
    vi.mocked(zoteroCslResilient).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    refreshCitationPreviews();
    await vi.advanceTimersByTimeAsync(130);
    vi.mocked(zoteroCslResilient).mockResolvedValueOnce([book('a', 'NewAuthor')]);
    await zoteroSetCredentials('test-key', 'new-account');
    expect(rendered(editor)).toHaveLength(0);
    await settle();
    expect(rendered(editor)[0]).toContain('NewAuthor');
    resolveOld([book('a', 'StaleAuthor')]);
    await settle();
    expect(rendered(editor)[0]).toContain('NewAuthor');
    expect(rendered(editor)[0]).not.toContain('StaleAuthor');
  });

  it('waits for composition end before publishing an asynchronous result', async () => {
    const editor = mount('[@a]');
    mockComposing(editor, true);
    dispatchComposition(editor, { phase: 'compositionstart' });
    await settle();
    expect(rendered(editor)).toHaveLength(0);
    const source = editor.state.doc;
    mockComposing(editor, false);
    dispatchComposition(editor, { phase: 'compositionend' });
    await Promise.resolve();
    expect(rendered(editor)).toHaveLength(1);
    expect(editor.state.doc).toBe(source);
  });

  it('source mode removes presentation and discards a pending live result', async () => {
    const mode = new Compartment();
    let resolveMetadata!: (items: CslItem[]) => void;
    vi.mocked(zoteroCslResilient).mockReturnValueOnce(new Promise((resolve) => { resolveMetadata = resolve; }));
    const editor = mount('[@a]', mode.of(citationPreview));
    await vi.advanceTimersByTimeAsync(130);
    editor.dispatch({ effects: mode.reconfigure([]) });
    resolveMetadata([book('a')]);
    await settle();
    expect(rendered(editor)).toHaveLength(0);
    expect(editor.contentDOM.textContent).toContain('[@a]');
  });

  it('missing metadata retains the full source and exposes a local formatting error', async () => {
    vi.mocked(zoteroCslResilient).mockResolvedValueOnce([]);
    const editor = mount('[@a]');
    await settle();
    expect(rendered(editor)).toHaveLength(0);
    expect(editor.contentDOM.querySelector('.cm-ink-citation-error')).toHaveAttribute('title', expect.stringContaining('未找到引用'));
    expect(editor.state.doc.toString()).toBe('[@a]\n\nTail');
  });

  it('citation metadata cannot introduce executable or interactive HTML', async () => {
    vi.mocked(zoteroCslResilient).mockResolvedValueOnce([book('a', '<img src=x onerror=alert(1)>')]);
    const editor = mount('[@a]\n\n<!-- biblio:apa -->');
    await settle();
    expect(editor.contentDOM.querySelector('.cm-ink-citation img, .cm-ink-citation script, .cm-ink-citation [onerror]')).toBeNull();
    expect(editor.state.doc.toString()).toContain('[@a]');
  });
});
