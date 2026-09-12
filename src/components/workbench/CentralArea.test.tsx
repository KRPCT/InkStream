import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getView } from '../../editor/viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import CentralArea from './CentralArea';

beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useVaultStore.setState(useVaultStore.getInitialState(), true);
  useSettingsStore.setState({ simpleMode: true, bookshelfEnabled: false });
});

afterEach(() => {
  cleanup();
  useSettingsStore.setState({ simpleMode: false, bookshelfEnabled: false });
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
});

describe('CentralArea 的有效视图', () => {
  it.each(['graph', 'gitGraph', 'mergeResolve', 'multibuffer', 'bookshelf'] as const)(
    '能力不可用时残留 %s 请求仍显示原编辑器，不因恢复导航重建视图',
    (view) => {
      useWorkbenchStore.getState().setCentralView(view);
      render(<CentralArea />);
      const editorMount = screen.getByTestId('cm-mount');
      const editorView = getView();

      expect(editorMount).toBeVisible();
      expect(editorView).not.toBeNull();

      act(() => useWorkbenchStore.getState().setCentralView('editor'));
      expect(screen.getByTestId('cm-mount')).toBe(editorMount);
      expect(getView()).toBe(editorView);
    },
  );

  it.each(['reading', 'bookshelf'] as const)(
    '简易模式下仍可用的 %s 接管中央区，编辑器只隐藏而不卸载',
    (view) => {
      useSettingsStore.setState({ bookshelfEnabled: true });
      useWorkbenchStore.getState().setCentralView(view);
      render(<CentralArea />);
      const editorMount = screen.getByTestId('cm-mount');
      const editorView = getView();

      expect(editorMount).not.toBeVisible();
      expect(editorView).not.toBeNull();
      act(() => useWorkbenchStore.getState().setCentralView('editor'));
      expect(editorMount).toBeVisible();
      expect(getView()).toBe(editorView);
    },
  );
});
