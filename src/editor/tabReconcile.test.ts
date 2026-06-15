import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { __clearCacheForTest, openFile } from './editorState';
import { __resetDraftCounterForTest } from './draftPath';
import { baseExtensions } from './extensions';
import { imageVaultFacet } from './livepreview/inlinePlugin';
import { rehomeTabsForVaultSwitch } from './tabReconcile';
import { setView } from './viewHandle';

/**
 * #3 切库重归位回归门：rehome 必须把旧库内 tab 的 key 迁到其**绝对路径**（external），
 * 绝不让旧 tab 继续以相对键存在于新库下——那正是 autosave 覆盖新库同名文件的数据丢失元凶。
 * 纯按路径计算 + store/缓存键迁移，无需 view/读盘。
 */
function tabState() {
  const s = useEditorStore.getState();
  return s.tabs.map((t) => ({ path: t.path, external: t.external ?? false }));
}

beforeEach(() => {
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  __clearCacheForTest();
  __resetDraftCounterForTest();
});

describe('rehomeTabsForVaultSwitch', () => {
  it('切到同级新库：旧库内 tab 变 external（绝对键）；dirty/activePath 随迁，不再指向新库相对路径', () => {
    useEditorStore.getState().openTab({ path: 'notes/a.md', name: 'a.md' });
    useEditorStore.getState().setActive('notes/a.md');
    useEditorStore.getState().markDirty('notes/a.md');

    rehomeTabsForVaultSwitch('D:/VaultA', 'D:/VaultB');

    expect(tabState()).toEqual([{ path: 'D:/VaultA/notes/a.md', external: true }]);
    // 未落盘脏标记随键迁移、不丢、不残留旧键。
    expect(useEditorStore.getState().dirty['D:/VaultA/notes/a.md']).toBe(true);
    expect('notes/a.md' in useEditorStore.getState().dirty).toBe(false);
    // 活动 tab 跟随新键。
    expect(useEditorStore.getState().activePath).toBe('D:/VaultA/notes/a.md');
  });

  it('切回包含该 external 文件的库：external 文件回归库内相对 tab（去 external）', () => {
    useEditorStore.getState().openTab({ path: 'D:/VaultA/notes/a.md', name: 'a.md', external: true });
    rehomeTabsForVaultSwitch('D:/VaultB', 'D:/VaultA');
    expect(tabState()).toEqual([{ path: 'notes/a.md', external: false }]);
  });

  it('切到旧库子目录：库内 tab 改用新（更短）相对键，仍属工作区', () => {
    useEditorStore.getState().openTab({ path: 'sub/x.md', name: 'x.md' });
    rehomeTabsForVaultSwitch('D:/Vault', 'D:/Vault/sub');
    expect(tabState()).toEqual([{ path: 'x.md', external: false }]);
  });

  it('草稿 tab 与已是新库内的 tab 不动（无键变化）', () => {
    useEditorStore.getState().openTab({ path: 'draft://1', name: '未命名-1' });
    useEditorStore.getState().openTab({ path: 'keep.md', name: 'keep.md' });
    // 切到同一根（重开当前库）：keep.md 仍相对、草稿不动。
    rehomeTabsForVaultSwitch('D:/Vault', 'D:/Vault');
    expect(tabState()).toEqual([
      { path: 'draft://1', external: false },
      { path: 'keep.md', external: false },
    ]);
  });
});

describe('rehomeTabsForVaultSwitch 图片上下文重导（review 修复）', () => {
  function mountView(): EditorView {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({ doc: '', extensions: baseExtensions() }),
      parent,
    });
    setView(view);
    return view;
  }

  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useVaultStore.setState(useVaultStore.getInitialState(), true);
    __clearCacheForTest();
    __resetDraftCounterForTest();
  });

  afterEach(() => {
    setView(null);
    useVaultStore.setState(useVaultStore.getInitialState(), true);
  });

  it('切到同级库后活动 tab 的 imageVaultFacet 按新（external 绝对）key 重导', () => {
    useVaultStore.setState({ vault: { root: 'D:/VaultA', repoRoot: null, name: 'VaultA' } });
    const view = mountView();
    openFile(view, 'notes/a.md', '# hi\n', baseExtensions('markdown'));
    useEditorStore.getState().openTab({ path: 'notes/a.md', name: 'a.md' });
    useEditorStore.getState().setActive('notes/a.md');
    // 开库时：库内上下文（根=vault 根，docPath=相对）。
    expect(view.state.facet(imageVaultFacet)).toEqual({ root: 'D:/VaultA', docPath: 'notes/a.md' });

    rehomeTabsForVaultSwitch('D:/VaultA', 'D:/VaultB'); // 切同级库 → 'notes/a.md' 变 external 绝对键

    // rehome 后：external 绝对键 'D:/VaultA/notes/a.md' → 上下文按文件所在目录重导（不再是旧 vault 根）。
    expect(useEditorStore.getState().activePath).toBe('D:/VaultA/notes/a.md');
    expect(view.state.facet(imageVaultFacet)).toEqual({ root: 'D:/VaultA/notes', docPath: 'a.md' });
    view.destroy();
  });
});
