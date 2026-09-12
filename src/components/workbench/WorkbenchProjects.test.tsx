import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getView } from '../../editor/viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import WorkbenchLayout from './WorkbenchLayout';

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useProjectStore.setState({ ready: true, phase: 'idle', activeId: null, archiveOpen: false, error: null, catalog: { version: 1, activeId: null, projects: [] } });
  useSettingsStore.setState({ simpleMode: false });
});
afterEach(cleanup);

describe('project presentation preserves the mounted writing surface', () => {
  it('makes the background inert while leaving the archive and project rail operable', () => {
    render(<WorkbenchLayout />);
    const editor = getView();
    const element = screen.getByTestId('editor-area');
    act(() => useProjectStore.getState().setArchiveOpen(true));
    expect(screen.getByTestId('workbench-content')).toHaveAttribute('inert');
    expect(screen.getByRole('dialog', { name: '项目档案' }).closest('[inert]')).toBeNull();
    expect(screen.getByRole('navigation', { name: '项目与工作台' }).closest('[inert]')).toBeNull();
    expect(screen.getByTestId('editor-area')).toBe(element);
    expect(getView()).toBe(editor);
    act(() => useProjectStore.getState().setArchiveOpen(false));
    expect(screen.getByTestId('workbench-content')).not.toHaveAttribute('inert');
    expect(getView()).toBe(editor);
  });

  it('keeps direct typing blocked for a project handover started outside the archive', () => {
    render(<WorkbenchLayout />);
    const editor = getView();
    act(() => useProjectStore.setState({ phase: 'restoring' }));
    expect(screen.getByTestId('workbench-content')).toHaveAttribute('inert');
    expect(screen.getByText('恢复项目会话…')).toBeVisible();
    act(() => useProjectStore.setState({ phase: 'idle' }));
    expect(screen.getByTestId('workbench-content')).not.toHaveAttribute('inert');
    expect(getView()).toBe(editor);
  });
});
