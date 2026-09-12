import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { undo } from '@codemirror/commands';
import { useProjectStore } from '../../stores/useProjectStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { getView } from '../../editor/viewHandle';
import { newDraftDocument } from '../../editor/draftFlow';
import CentralArea from './CentralArea';
import { openFileByPath } from '../../editor/fileOpenFlow';
vi.mock('../../ipc/zotero', async (original) => ({ ...await original<typeof import('../../ipc/zotero')>(),
  zoteroItemsResilient: async () => ({ items: [{ citekey: 'example2026', title: '真实插入行为', authors: '作者', year: '2026' }], offline: false }),
  zoteroCslResilient: async () => [{ id: 'example2026', DOI: '10.0000/example' }],
}));
vi.mock('../../ipc/files', async (original) => ({ ...await original<typeof import('../../ipc/files')>(), readFile: async () => '# 项目里的文稿\n正文' }));
beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useVaultStore.setState(useVaultStore.getInitialState(), true);
  useProjectStore.setState({ phase: 'idle', archiveOpen: false, activeId: null });
  useSettingsStore.setState({ simpleMode: false });
});
it('WB-01 概览往返不卸载真实编辑器，保留修改、选区、撤销；概览数据来自会话', () => {
  render(<CentralArea />);
  act(() => newDraftDocument());
  const view = getView()!;
  act(() => view.dispatch({ changes: { from: 0, insert: '保留文稿' }, selection: { anchor: 1, head: 3 } }));
  const state = view.state;
  fireEvent.click(screen.getByRole('tab', { name: '概览' }));
  expect(screen.getByText('已开文稿').nextElementSibling).toHaveTextContent('1');
  expect(screen.getByTestId('cm-mount')).not.toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: '文稿' }));
  expect(screen.getByTestId('cm-mount')).toBeVisible(); expect(getView()).toBe(view); expect(view.state).toBe(state);
  act(() => { undo(view); }); expect(view.state.doc.toString()).toBe('');
});
it('WB-03 文献工作区先查看，再明确插入到原文稿选区；撤销可恢复正文', async () => {
  render(<CentralArea />);
  act(() => newDraftDocument());
  const view = getView()!;
  act(() => view.dispatch({ changes: { from: 0, insert: '甲乙' }, selection: { anchor: 1 } }));
  fireEvent.click(screen.getByRole('tab', { name: '文献' }));
  fireEvent.click(await screen.findByText('真实插入行为'));
  expect(view.state.doc.toString()).toBe('甲乙'); expect(screen.getByTestId('cm-mount')).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '插入所选引用' }));
  await waitFor(() => expect(view.state.doc.toString()).toBe('甲[@example2026]乙'));
  expect(screen.getByTestId('cm-mount')).toBeVisible(); expect(getView()).toBe(view);
  act(() => { undo(view); }); expect(view.state.doc.toString()).toBe('甲乙');
});
it('WB-01 从概览使用文件导航会显示所开文稿，复用同一编辑器', async () => {
  useVaultStore.setState({ vault: { root: 'D:/workspace', name: '工作区', repoRoot: null } });
  render(<CentralArea />);
  const view = getView();
  fireEvent.click(screen.getByRole('tab', { name: '概览' }));
  await act(async () => openFileByPath('draft.md'));
  expect(screen.getByTestId('cm-mount')).toBeVisible(); expect(getView()).toBe(view);
  expect(useEditorStore.getState().activePath).toBe('draft.md');
  expect(view?.state.doc.toString()).toBe('# 项目里的文稿\n正文');
});
