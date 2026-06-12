import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { pickSavePath } from '../ipc/dialog';
import { writeFileToPath } from '../ipc/files';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { newDraftDocument, saveDraftAs } from './draftFlow';
import { __resetDraftCounterForTest } from './draftPath';
import { __clearCacheForTest } from './editorState';
import { baseExtensions } from './extensions';
import { openFileByPath } from './fileOpenFlow';
import { refreshTree } from './fileTreeData';
import { switchVault } from './vaultFlow';
import { setView } from './viewHandle';

vi.mock('../ipc/dialog', () => ({
  pickFile: vi.fn(),
  pickFolder: vi.fn(),
  pickSavePath: vi.fn(),
}));
vi.mock('../ipc/files', () => ({
  writeFileToPath: vi.fn().mockResolvedValue(null),
  readFile: vi.fn(),
}));
vi.mock('../stores/useToastStore', () => ({ showToast: vi.fn() }));
vi.mock('./fileOpenFlow', () => ({ openFileByPath: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./fileTreeData', () => ({ refreshTree: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./vaultFlow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./vaultFlow')>()),
  switchVault: vi.fn().mockResolvedValue(undefined),
}));

const mockPick = vi.mocked(pickSavePath);
const mockWrite = vi.mocked(writeFileToPath);

/** 在 jsdom 中建一个挂载好的 EditorView 并登记到 viewHandle（同 editorState.test）。 */
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

describe('draftFlow', () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWrite.mockResolvedValue(null);
    __resetDraftCounterForTest();
    __clearCacheForTest();
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useVaultStore.setState(useVaultStore.getInitialState(), true);
    view = mountView();
  });

  afterEach(() => {
    view.destroy();
    setView(null);
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    useVaultStore.setState(useVaultStore.getInitialState(), true);
  });

  it('newDraftDocument：无 vault 也开空 markdown 草稿 tab 并激活', () => {
    newDraftDocument();
    const s = useEditorStore.getState();
    expect(s.tabs).toEqual([{ path: 'draft://1', name: '未命名-1' }]);
    expect(s.activePath).toBe('draft://1');
    expect(view.state.doc.toString()).toBe('');
  });

  it('连续新建草稿递增编号，各自独立 tab', () => {
    newDraftDocument();
    newDraftDocument();
    const s = useEditorStore.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(['draft://1', 'draft://2']);
    expect(s.activePath).toBe('draft://2');
  });

  it('saveDraftAs 取消对话框：no-op，草稿保留', async () => {
    newDraftDocument();
    mockPick.mockResolvedValue(null);
    await saveDraftAs('draft://1');
    expect(mockWrite).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(['draft://1']);
  });

  it('保存到当前 vault 内：写盘 → 按相对路径打开 + refreshTree + 关草稿', async () => {
    useVaultStore.setState({ vault: { root: '/v', repoRoot: null, name: 'v' } });
    newDraftDocument();
    view.dispatch({ changes: { from: 0, insert: '草稿内容' } });
    mockPick.mockResolvedValue('/v/notes/新文.md');
    await saveDraftAs('draft://1');
    // 默认文件名取 tab 名 + .md
    expect(mockPick).toHaveBeenCalledWith('未命名-1.md');
    // 落盘内容是 live view 真相源
    expect(mockWrite).toHaveBeenCalledWith('/v/notes/新文.md', '草稿内容');
    expect(openFileByPath).toHaveBeenCalledWith('notes/新文.md');
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(switchVault).not.toHaveBeenCalled();
    // 草稿 tab 已关闭
    expect(useEditorStore.getState().tabs.some((t) => t.path === 'draft://1')).toBe(false);
  });

  it('无 vault 保存：切到父目录作 vault 后按文件名打开 + 关草稿', async () => {
    newDraftDocument();
    view.dispatch({ changes: { from: 0, insert: 'x' } });
    mockPick.mockResolvedValue('D:\\docs\\草稿.md');
    await saveDraftAs('draft://1');
    expect(mockWrite).toHaveBeenCalledWith('D:\\docs\\草稿.md', 'x');
    expect(switchVault).toHaveBeenCalledWith('D:/docs');
    expect(openFileByPath).toHaveBeenCalledWith('草稿.md');
    expect(useEditorStore.getState().tabs.some((t) => t.path === 'draft://1')).toBe(false);
  });

  it('写盘失败：错误 toast，草稿保留不关', async () => {
    newDraftDocument();
    mockPick.mockResolvedValue('/v/a.md');
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    await saveDraftAs('draft://1');
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('保存失败'));
    expect(openFileByPath).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs.map((t) => t.path)).toEqual(['draft://1']);
  });
});
