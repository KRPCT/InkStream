import { history } from '@codemirror/commands';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readText } from '../ipc/clipboard';
import { zoteroCayw } from '../ipc/zotero';
import { useEditorStore } from '../stores/useEditorStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { useProjectStore } from '../stores/useProjectStore';
import { dispatchComposition, mockComposing } from '../test/composition';
import { insertCitation, insertCitekey, insertFootnote } from './academicActions';
import { insertOrExpandBibliography } from './bibliography';
import { compositionGate } from './composition';
import { doPaste, doRedo, doUndo } from './editCommands';
import { beginDocumentNavigation } from './editorState.navigation';
import { numberEquations } from './equations/commands';
import { bold, runMarkdownCommand } from './markdownCommands';
import { getView, setView } from './viewHandle';

vi.mock('../ipc/zotero', async (original) => ({
  ...await original<typeof import('../ipc/zotero')>(), zoteroCayw: vi.fn(),
}));

let view: EditorView;
beforeEach(() => {
  vi.clearAllMocks();
  beginDocumentNavigation();
  useWorkbenchStore.setState({ centralView: 'editor' });
  useProjectStore.setState({ archiveOpen: false, phase: 'idle' });
  useSettingsStore.setState({ simpleMode: false, bookshelfEnabled: false });
  useVaultStore.setState({ vault: null });
  useEditorStore.setState({ ...useEditorStore.getInitialState(), activePath: 'a.md', tabs: [{ path: 'a.md', name: 'a.md' }], activeRenderMode: 'source' }, true);
  view = new EditorView({ state: EditorState.create({ doc: 'Original text', selection: { anchor: 0, head: 8 }, extensions: [history(), compositionGate] }) });
  document.body.appendChild(view.dom);
  setView(view);
  vi.mocked(readText).mockResolvedValue('paste');
  vi.mocked(zoteroCayw).mockResolvedValue('[@paper]');
});
afterEach(() => {
  useProjectStore.setState({ archiveOpen: false, phase: 'idle' });
  setView(null);
  view.destroy();
  view.dom.remove();
  useWorkbenchStore.setState({ centralView: 'editor' });
  useSettingsStore.setState({ simpleMode: false, bookshelfEnabled: false });
});

it('archive and project handover retire pending clipboard commands and preserve hidden undo', async () => {
  view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } });
  const saved = view.state;
  let finish!: (text: string) => void;
  vi.mocked(readText).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const pending = doPaste();
  useProjectStore.setState({ archiveOpen: true });
  doUndo();
  expect(view.state).toBe(saved);
  useProjectStore.setState({ archiveOpen: false, phase: 'restoring' });
  doUndo();
  expect(view.state).toBe(saved);
  useProjectStore.setState({ phase: 'idle' });
  finish('stale paste');
  await pending;
  expect(view.state).toBe(saved);
  doUndo();
  expect(view.state.doc.toString()).toBe('Original text');
});

describe('commands follow the same visible fallback as CentralArea', () => {
  const cases = [
    { name: 'simple mode with a retained Git graph request', requested: 'gitGraph', visible: { simpleMode: true, bookshelfEnabled: false }, hidden: { simpleMode: false, bookshelfEnabled: false } },
    { name: 'disabled bookshelf with a retained bookshelf request', requested: 'bookshelf', visible: { simpleMode: false, bookshelfEnabled: false }, hidden: { simpleMode: false, bookshelfEnabled: true } },
  ] as const;

  it.each(cases)('$name permits commands on the visible editor', async ({ requested, visible }) => {
    useWorkbenchStore.setState({ centralView: requested });
    useSettingsStore.setState(visible);
    await doPaste();
    expect(view.state.doc.toString()).toBe('paste text');
    expect(useWorkbenchStore.getState().centralView).toBe(requested);
  });

  it.each(cases)('$name retires an old intent when settings hide and then show the editor again', async ({ requested, visible, hidden }) => {
    useWorkbenchStore.setState({ centralView: requested });
    useSettingsStore.setState(visible);
    let finish!: (text: string) => void;
    vi.mocked(readText).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = doPaste();
    const preserved = view.state;
    useSettingsStore.setState(hidden);
    useSettingsStore.setState(visible);
    finish('stale clipboard');
    await pending;
    expect(view.state).toBe(preserved);
    await doPaste();
    expect(view.state.doc.toString()).toBe('paste text');
  });
});

describe('commands preserve the document behind another surface', () => {
  it.each(['comparison', 'readonly'] as const)('%s rejects all public writing commands without changing the main handle or history', async (surface) => {
    view.dispatch({ changes: { from: view.state.doc.length, insert: '!' } });
    if (surface === 'comparison') useWorkbenchStore.setState({ centralView: 'gitGraph' });
    else view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
    const before = view.state;
    doUndo(); doRedo(); runMarkdownCommand(bold); insertCitekey('paper'); insertFootnote(); numberEquations();
    await insertOrExpandBibliography(); await doPaste(); await insertCitation();
    expect(view.state).toBe(before);
    expect(getView()).toBe(view);
    expect(readText).not.toHaveBeenCalled();
    expect(zoteroCayw).not.toHaveBeenCalled();
    if (surface === 'comparison') {
      useWorkbenchStore.setState({ centralView: 'editor' });
      doUndo();
      expect(view.state.doc.toString()).toBe('Original text');
    }
  });

  for (const command of ['paste', 'citation'] as const) {
    it.each(['document', 'selection', 'navigate-back', 'comparison-back'] as const)(`${command} abandons its original intent after %s changes`, async (change) => {
      let finish!: (text: string) => void;
      const response = new Promise<string>((resolve) => { finish = resolve; });
      if (command === 'paste') vi.mocked(readText).mockReturnValueOnce(response);
      else vi.mocked(zoteroCayw).mockReturnValueOnce(response);
      const pending = command === 'paste' ? doPaste() : insertCitation();
      if (change === 'document') view.dispatch({ changes: { from: 8, insert: ' revised' } });
      if (change === 'selection') view.dispatch({ selection: { anchor: 13 } });
      if (change === 'navigate-back') {
        const original = view.state;
        beginDocumentNavigation();
        view.setState(EditorState.create({ doc: 'Another document' }));
        useEditorStore.setState({ activePath: 'b.md' });
        beginDocumentNavigation();
        view.setState(original);
        useEditorStore.setState({ activePath: 'a.md' });
      }
      if (change === 'comparison-back') {
        useWorkbenchStore.setState({ centralView: 'gitGraph' });
        useWorkbenchStore.setState({ centralView: 'editor' });
      }
      const preserved = view.state;
      finish(command === 'paste' ? 'late clipboard' : '[@late]');
      await pending;
      expect(view.state).toBe(preserved);
    });
  }

  it('a citation still inserts and formats for the unchanged original Typst document', async () => {
    useEditorStore.setState({ activePath: 'paper.typ', tabs: [{ path: 'paper.typ', name: 'paper.typ' }] });
    await insertCitation();
    expect(view.state.doc.toString()).toBe('#cite(<paper>) text');
  });

  it('a clipboard response queued during IME cannot write after opening and closing comparison', async () => {
    let finish!: (text: string) => void;
    vi.mocked(readText).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = doPaste();
    mockComposing(view, true);
    dispatchComposition(view, { phase: 'compositionstart' });
    finish('late clipboard');
    await Promise.resolve();
    const preserved = view.state.doc;
    useWorkbenchStore.setState({ centralView: 'gitGraph' });
    useWorkbenchStore.setState({ centralView: 'editor' });
    mockComposing(view, false);
    dispatchComposition(view, { phase: 'compositionend' });
    await pending;
    expect(view.state.doc).toBe(preserved);
  });
});
