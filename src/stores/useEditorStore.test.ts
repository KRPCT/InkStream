import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from './useEditorStore';

function reset(): void {
  useEditorStore.setState({ tabs: [], activePath: null, dirty: {}, cursor: 0, frozen: {} });
}

describe('useEditorStore', () => {
  beforeEach(reset);

  it('openTab adds a tab and setActive marks it active', () => {
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    useEditorStore.getState().setActive('a.md');
    const s = useEditorStore.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(['a.md']);
    expect(s.activePath).toBe('a.md');
  });

  it('openTab is idempotent on the same path', () => {
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it('markDirty flips dirty flag, clearDirty resets it', () => {
    useEditorStore.getState().markDirty('a.md');
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
    useEditorStore.getState().clearDirty('a.md');
    expect(useEditorStore.getState().dirty['a.md']).toBe(false);
  });

  it('setCursor mirrors cursor position (StatusBar 消费)', () => {
    useEditorStore.getState().setCursor(42);
    expect(useEditorStore.getState().cursor).toBe(42);
  });

  it('closeTab removes the tab and its dirty flag (释放)', () => {
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    useEditorStore.getState().openTab({ path: 'b.md', name: 'b.md' });
    useEditorStore.getState().setActive('a.md');
    useEditorStore.getState().markDirty('a.md');
    useEditorStore.getState().closeTab('a.md');
    const s = useEditorStore.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(['b.md']);
    expect(s.dirty['a.md']).toBeUndefined();
    // 关掉活动 tab 后活动切到剩余 tab
    expect(s.activePath).toBe('b.md');
  });

  it('freezeAutosave / unfreezeAutosave 切换 frozen 标志（02-04 冲突期防误覆盖）', () => {
    useEditorStore.getState().freezeAutosave('a.md');
    expect(useEditorStore.getState().frozen['a.md']).toBe(true);
    useEditorStore.getState().unfreezeAutosave('a.md');
    expect(useEditorStore.getState().frozen['a.md']).toBe(false);
  });

  it('closeTab 同时清除 frozen 标志（释放）', () => {
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    useEditorStore.getState().freezeAutosave('a.md');
    useEditorStore.getState().closeTab('a.md');
    expect(useEditorStore.getState().frozen['a.md']).toBeUndefined();
  });

  it('store holds no EditorView/EditorState instance fields', () => {
    const keys = Object.keys(useEditorStore.getState());
    expect(keys).not.toContain('view');
    expect(keys).not.toContain('editorState');
  });
});
