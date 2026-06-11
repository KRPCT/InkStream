import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { writeFileAtomic } from '../ipc/files';
import { baseExtensions } from '../editor/extensions';
import {
  __clearCacheForTest,
  openFile,
  snapshotBeforeSwitch,
} from '../editor/editorState';
import { setView } from '../editor/viewHandle';
import { useEditorStore } from './useEditorStore';
import { useVaultStore } from './useVaultStore';
import { flushAutosave, resetAutosave, scheduleAutosave } from './autosave';

/**
 * CR-01 / CR-02 / WR-08 回归：默认 getDoc 按 path 取真相源、关 tab flush 串行化。
 *
 * 这些用例**不**经 configureAutosave 注入 getDoc 桩——专测生产默认实现：
 * 跨文件覆盖的缺陷只在真实默认 getDoc + 单内核换装路径上暴露。
 */

vi.mock('../ipc/files', () => ({
  writeFileAtomic: vi.fn().mockResolvedValue(null),
}));

const mockWrite = writeFileAtomic as Mock;

/** 在 jsdom 中建一个挂载好的单内核 EditorView 并登记为全 App 句柄。 */
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

function resetStores(): void {
  useVaultStore.setState({ vault: { root: '/vault', repoRoot: null, name: 'v' }, tree: [], files: [], expanded: new Set() });
  useEditorStore.setState({
    tabs: [],
    activePath: null,
    dirty: {},
    frozen: {},
    externalChanged: {},
    cursor: 0,
    isRichtext: false,
  });
}

describe('autosave 默认 getDoc 按 path 取文档（CR-01 跨文件覆盖回归）', () => {
  let view: EditorView;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockWrite.mockResolvedValue(null);
    __clearCacheForTest();
    resetStores();
    resetAutosave(); // 还原真实默认 deps（不注入桩）
    view = mountView();
  });

  afterEach(() => {
    resetAutosave();
    view.destroy();
    setView(null);
    vi.useRealTimers();
  });

  it('编辑 A → 防抖窗口内切到 B → A 的定时器落盘的是 A 内容而非 B', async () => {
    // 打开 A 并编辑
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    useEditorStore.getState().setActive('a.md');
    openFile(view, 'a.md', 'A-原始', baseExtensions());
    view.dispatch({ changes: { from: view.state.doc.length, insert: '-编辑A' } });
    // 为 A 武装防抖定时器
    scheduleAutosave('a.md');

    // 500ms 内切到 B：单内核 setState 换装（snapshot A → 加载 B）
    snapshotBeforeSwitch(view, 'a.md');
    useEditorStore.getState().openTab({ path: 'b.md', name: 'b.md' });
    openFile(view, 'b.md', 'B-原始', baseExtensions());
    useEditorStore.getState().setActive('b.md');

    // A 的防抖定时器现在触发
    await vi.runAllTimersAsync();

    // 落盘必须是 A 的内容（'A-原始-编辑A'），绝不能是当前 live view 的 B 内容
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('/vault', 'a.md', 'A-原始-编辑A');
  });

  it('活动文件落盘读 live view 的最新编辑（缓存可能更陈旧）', async () => {
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    useEditorStore.getState().setActive('a.md');
    openFile(view, 'a.md', 'live', baseExtensions());
    view.dispatch({ changes: { from: view.state.doc.length, insert: '-新' } });
    await flushAutosave('a.md');
    expect(mockWrite).toHaveBeenCalledWith('/vault', 'a.md', 'live-新');
  });
});
