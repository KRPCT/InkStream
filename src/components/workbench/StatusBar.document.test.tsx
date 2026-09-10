import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseExtensions } from '../../editor/extensions';
import { __clearCacheForTest, openFile } from '../../editor/editorState';
import { setView } from '../../editor/viewHandle';
import { resetAutosave } from '../../stores/autosave';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import StatusBar from './StatusBar';
import ChapterSceneTree from './ChapterSceneTree';

vi.mock('../../ipc/files', () => ({ readFile: vi.fn(async () => '---\nstatus: draft\n---\n甲乙') }));
vi.mock('../../ipc/vault', () => ({ listDir: vi.fn(async (_root: string, path: string) => path === ''
  ? [{ name: '第一章', isDir: true }, { name: 'Codex', isDir: true }]
  : [{ name: path === 'Codex' ? '角色.md' : 's1.md', isDir: false }]) }));

let view: EditorView;
beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useVaultStore.setState({ vault: { root: '/status', name: 'Status', repoRoot: null }, tree: [] });
  useWorkbenchStore.setState({ mode: 'standard', centralView: 'editor' });
  useSettingsStore.setState({ simpleMode: false, autosaveEnabled: false });
  view = new EditorView({ state: EditorState.create({ extensions: baseExtensions() }), parent: document.body });
  setView(view);
});
afterEach(() => { cleanup(); view.destroy(); setView(null); __clearCacheForTest(); resetAutosave(); });

async function open(path: string, text: string) {
  await act(async () => {
    useEditorStore.getState().openTab({ path, name: path });
    await openFile(view, path, text, baseExtensions());
  });
}

describe('status bar mirrors the actual document', () => {
  it('shows Standard document and selection counts and updates after an edit', async () => {
    await open('a.md', '甲乙 hello world');
    render(<StatusBar />);
    expect(screen.getByText('正文 4 字')).toBeVisible();
    act(() => view.dispatch({ selection: { anchor: 0, head: 2 } }));
    expect(screen.getByText('已选 2 / 正文 4 字')).toBeVisible();
    act(() => view.dispatch({ changes: { from: 2, insert: '丙' }, selection: { anchor: 3 } }));
    expect(screen.getByText('正文 5 字')).toBeVisible();
  });

  it('shows Creative chapter/scene totals without treating Codex entries as scenes, and reflects unsaved status changes', async () => {
    useWorkbenchStore.setState({ mode: 'creative' });
    await open('第一章/s1.md', '---\nstatus: draft\n---\n甲乙');
    render(<><ChapterSceneTree /><StatusBar /></>);
    const bar = within(screen.getByTestId('status-bar'));
    await waitFor(() => expect(bar.getByText('1 章 · 1 场景')).toBeVisible());
    expect(bar.getByText('草稿')).toBeVisible();
    act(() => view.dispatch({ changes: { from: 12, to: 17, insert: 'final' } }));
    expect(bar.getByText('定稿')).toBeVisible();
  });

  it('does not retain the previous project scene totals while a new project is loading', async () => {
    useWorkbenchStore.setState({ mode: 'creative' });
    render(<><ChapterSceneTree /><StatusBar /></>);
    await screen.findByText('1 章 · 1 场景');
    act(() => useVaultStore.setState({ vault: { root: '/B', name: 'B', repoRoot: null }, tree: [] }));
    expect(screen.queryByText('1 章 · 1 场景')).not.toBeInTheDocument();
  });
});
