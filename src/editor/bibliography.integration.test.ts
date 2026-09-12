import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zoteroCslResilient, zoteroSetCredentials } from '../ipc/zotero';
import { useEditorStore } from '../stores/useEditorStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import type { CslItem } from '../types/zotero';
import { expandBibliographyAs } from './bibliography';
import { __clearCacheForTest, getDocForPath, openFile, snapshotBeforeSwitch } from './editorState';
import { baseExtensions } from './extensions';
import { setView } from './viewHandle';

vi.mock('../ipc/zotero', async (original) => ({
  ...await original<typeof import('../ipc/zotero')>(), zoteroCslResilient: vi.fn(),
}));
const block = '<!-- biblio -->\n\nOriginal bibliography\n\n<!-- /biblio -->';
const entry = (key: string, title: string): CslItem => ({
  'citation-key': key, type: 'article-journal', title,
  author: [{ family: key, given: 'A' }], issued: { 'date-parts': [[2025]] },
});
let view: EditorView;
let parent: HTMLDivElement;
async function activate(path: string, content: string) {
  const active = useEditorStore.getState().activePath;
  if (active) snapshotBeforeSwitch(view, active);
  useEditorStore.getState().openTab({ path, name: path });
  await openFile(view, path, content, baseExtensions('markdown'));
}
beforeEach(() => {
  vi.clearAllMocks(); __clearCacheForTest();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useVaultStore.setState({ vault: { root: '/references', name: 'references', repoRoot: null } });
  useSettingsStore.setState({ autosaveEnabled: false });
  useWorkbenchStore.setState({ centralView: 'editor' });
  parent = document.createElement('div'); document.body.appendChild(parent);
  view = new EditorView({ state: EditorState.create(), parent }); setView(view);
});
afterEach(() => { view.destroy(); setView(null); parent.remove(); __clearCacheForTest(); });

describe('bibliography document transaction', () => {
  it('a library change retires a pending bibliography generation even if the document stays active', async () => {
    const content = `[@first]\n\n${block}`;
    await activate('a.md', content);
    let complete!: (items: CslItem[]) => void;
    vi.mocked(zoteroCslResilient).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const rendering = expandBibliographyAs('apa');
    await zoteroSetCredentials('test-key', 'another-account');
    complete([entry('first', 'Old account paper')]);
    await rendering;
    expect(view.state.doc.toString()).toBe(content);
  });

  it('bibliography examples remain unchanged while the actual reference block is generated', async () => {
    const example = '```md\n<!-- biblio:apa -->\n[@example]\n<!-- /biblio -->\n```';
    await activate('a.md', `${example}\n\n[@first]\n\n${block}`);
    vi.mocked(zoteroCslResilient).mockResolvedValue([entry('first', 'Actual paper')]);
    await expandBibliographyAs('gbt7714');
    expect(view.state.doc.toString()).toContain(example);
    expect(view.state.doc.toString()).toContain('Actual paper');
    expect(view.state.doc.toString()).not.toContain('Original bibliography');
  });

  it.each(['comparison-back', 'selection'] as const)('a reference response after %s cannot replace the original bibliography', async (change) => {
    const content = `[@first]\n\n${block}`;
    await activate('a.md', content);
    let complete!: (items: CslItem[]) => void;
    vi.mocked(zoteroCslResilient).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const rendering = expandBibliographyAs('gbt7714');
    if (change === 'comparison-back') {
      useWorkbenchStore.setState({ centralView: 'gitGraph' });
      useWorkbenchStore.setState({ centralView: 'editor' });
    } else view.dispatch({ selection: { anchor: content.length } });
    complete([entry('first', 'First paper')]);
    await rendering;
    expect(view.state.doc.toString()).toBe(content);
  });

  it('a late reference response cannot write another active document', async () => {
    await activate('a.md', `[@first]\n\n${block}`);
    let complete!: (items: CslItem[]) => void;
    vi.mocked(zoteroCslResilient).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const rendering = expandBibliographyAs('gbt7714');
    await activate('b.md', 'Independent B body');
    complete([entry('first', 'First paper')]); await rendering;
    expect(view.state.doc.toString()).toBe('Independent B body');
    expect(getDocForPath('a.md')).toContain('Original bibliography');
  });

  it('an unresolved key keeps the previous complete bibliography', async () => {
    const content = `[@first] [@missing]\n\n${block}`;
    await activate('a.md', content);
    vi.mocked(zoteroCslResilient).mockResolvedValue([entry('first', 'First paper')]);
    await expandBibliographyAs('gbt7714');
    expect(view.state.doc.toString()).toBe(content);
  });

  it('numeric order follows the document even if Zotero returns entries in reverse order', async () => {
    await activate('a.md', `[@first] then [@second]\n\n${block}`);
    vi.mocked(zoteroCslResilient).mockResolvedValue([entry('second', 'Second paper'), entry('first', 'First paper')]);
    await expandBibliographyAs('gbt7714');
    const rendered = view.state.doc.toString();
    expect(rendered.indexOf('First paper')).toBeLessThan(rendered.indexOf('Second paper'));
  });

  it('manual bibliography edits made while references are loading remain intact', async () => {
    await activate('a.md', `[@first]\n\n${block}`);
    let complete!: (items: CslItem[]) => void;
    vi.mocked(zoteroCslResilient).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const rendering = expandBibliographyAs('gbt7714');
    const from = view.state.doc.toString().indexOf('Original bibliography');
    view.dispatch({ changes: { from, to: from + 'Original bibliography'.length, insert: 'My manual revision' } });
    complete([entry('first', 'First paper')]); await rendering;
    expect(view.state.doc.toString()).toContain('My manual revision');
  });
});
