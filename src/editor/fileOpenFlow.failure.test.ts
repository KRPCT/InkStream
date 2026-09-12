import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from '../ipc/files';
import { useEditorStore } from '../stores/useEditorStore';
import { useToastStore } from '../stores/useToastStore';
import { useVaultStore } from '../stores/useVaultStore';
import { openExternalFile, openFileByPath } from './fileOpenFlow';
import { setView } from './viewHandle';

vi.mock('../ipc/files', async (original) => ({
  ...await original<typeof import('../ipc/files')>(),
  readFile: vi.fn(),
}));

let view: EditorView;
beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useVaultStore.setState({ vault: { root: '/fixture', name: 'fixture', repoRoot: null } });
  useToastStore.setState({ toasts: [] });
  view = new EditorView({ state: EditorState.create({ doc: 'Keep the current document' }) });
  setView(view);
  vi.mocked(readFile).mockRejectedValue(new Error('文本文件超过100MiB读取上限'));
});
afterEach(() => { view.destroy(); setView(null); vi.clearAllMocks(); });

describe('file reading failure feedback', () => {
  it.each([
    ['workspace', () => openFileByPath('large.md')],
    ['external', () => openExternalFile('C:/external/large.md')],
  ] as const)('%s reading preserves the specific limit failure and the existing body', async (_kind, open) => {
    await open();
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('100MiB');
    expect(view.state.doc.toString()).toBe('Keep the current document');
  });
});
