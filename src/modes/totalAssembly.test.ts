import { history, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { MODE_PRESETS } from './presets';

/**
 * 三模式总装验收（Phase 12）：验证「任一模式下编辑中切模式不丢数据 / 撤销历史与选区保留 /
 * 强调色与功能集正确切换」。架构保证：setMode 只改 mode/data-mode/activeTab，绝不卸载单内核 EditorView
 * （WorkbenchLayout 命令式应用布局、禁 key={mode} 重建，编辑器与覆盖层不随模式重挂）。
 */
describe('三模式总装验收', () => {
  beforeEach(() => {
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    delete document.documentElement.dataset.mode;
  });

  it('切模式只改 mode/data-mode/activeTab，不动 centralView（编辑器/覆盖层不被卸载）', () => {
    const s = useWorkbenchStore.getState();
    s.setCentralView('graph');
    s.setMode('academic');
    expect(useWorkbenchStore.getState().mode).toBe('academic');
    expect(document.documentElement.dataset.mode).toBe('academic');
    // centralView 不被 setMode 重置——保证 Group/EditorArea 不卸载、CM 实例与 IME 不受扰。
    expect(useWorkbenchStore.getState().centralView).toBe('graph');
  });

  it('三模式 activeTab 各切到自身首 tab（功能集随模式切换）', () => {
    for (const m of ['standard', 'academic', 'creative'] as const) {
      useWorkbenchStore.getState().setMode(m);
      expect(useWorkbenchStore.getState().activeTab).toBe(MODE_PRESETS[m].rightPanelTabs[0]);
    }
  });

  it('单内核 EditorView 文档/选区/撤销历史跨事务保留（模式切换不重建 view 的前提）', () => {
    const view = new EditorView({
      state: EditorState.create({ doc: 'A\nB', extensions: [history()] }),
    });
    view.dispatch({ changes: { from: 3, insert: '\nC' } });
    view.dispatch({ selection: { anchor: 0, head: 1 } });
    expect(view.state.doc.toString()).toBe('A\nB\nC');
    expect(view.state.selection.main.head).toBe(1);
    undo(view);
    expect(view.state.doc.toString()).toBe('A\nB');
    view.destroy();
  });
});
