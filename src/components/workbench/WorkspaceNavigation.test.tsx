import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getView, setView } from '../../editor/viewHandle';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { effectiveCentralView } from '../../stores/effectiveCentralView';
import WorkspaceNavigation from './WorkspaceNavigation';

let view: EditorView;
beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useSettingsStore.setState({ simpleMode: false });
  useProjectStore.setState({ phase: 'idle', archiveOpen: false });
  useEditorStore.setState({ activePath: 'draft://workbench', tabs: [{ path: 'draft://workbench', name: '文稿' }], dirty: { 'draft://workbench': true } });
  view = new EditorView({ state: EditorState.create({ doc: '原文', extensions: [history()] }) });
  document.body.append(view.dom); setView(view);
  view.dispatch({ changes: { from: 2, insert: '未保存' }, selection: { anchor: 1, head: 3 } });
});
afterEach(() => { cleanup(); setView(null); view.destroy(); });

describe('多栏工作区导航', () => {
  it('WB-01 查看概览再返回文稿保留原编辑实例、正文、选区与撤销', () => {
    const state = view.state;
    render(<WorkspaceNavigation />);
    fireEvent.click(screen.getByRole('tab', { name: '概览' }));
    expect(useWorkbenchStore.getState().centralView).toBe('projectOverview');
    fireEvent.click(screen.getByRole('tab', { name: '文稿' }));
    expect(useWorkbenchStore.getState().centralView).toBe('editor');
    expect(getView()).toBe(view); expect(view.state).toBe(state);
    expect(useEditorStore.getState().activePath).toBe('draft://workbench');
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe('原文');
  });
  it.each([['文献', 'references'], ['版本', 'projectVersions']] as const)('WB-06 简易模式使%s目的地退回原文稿并隐藏高级入口', (label, destination) => {
    render(<WorkspaceNavigation />);
    fireEvent.click(screen.getByRole('tab', { name: label }));
    expect(useWorkbenchStore.getState().centralView).toBe(destination);
    act(() => useSettingsStore.getState().setSimpleMode(true));
    expect(effectiveCentralView(useWorkbenchStore.getState().centralView, { simpleMode: true, bookshelfEnabled: false })).toBe('editor');
    expect(screen.queryByRole('tab', { name: '文献' })).toBeNull();
    expect(view.state.doc.toString()).toBe('原文未保存');
  });
});
