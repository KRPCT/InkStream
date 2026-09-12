import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestOpenFile, requestOpenFolder, requestOpenRecent } from './vaultFlow';
import { useVaultStore } from '../stores/useVaultStore';
import type { VaultInfo } from '../types/vault';
import { useProjectStore } from '../stores/useProjectStore';
import { useEditorStore } from '../stores/useEditorStore';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { setView } from './viewHandle';

const project = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<boolean>>());
vi.mock('../projects/actions', () => ({ openProjectDirectory: project }));

const pickFolder = vi.fn<() => Promise<string | null>>();
const pickFile = vi.fn<() => Promise<string | null>>();
vi.mock('../ipc/dialog', () => ({
  pickFolder: () => pickFolder(),
  pickFile: () => pickFile(),
}));

const openVault = vi.fn<(path: string) => Promise<VaultInfo>>();
const listDir = vi.fn().mockResolvedValue([]);
const listFiles = vi.fn().mockResolvedValue([]);
vi.mock('../ipc/vault', () => ({
  openVault: (p: string) => openVault(p),
  listDir: (root: string, rel: string) => listDir(root, rel),
  listFiles: (root: string) => listFiles(root),
}));

const startWatch = vi.fn().mockResolvedValue(undefined);
const stopWatch = vi.fn().mockResolvedValue(undefined);
vi.mock('../ipc/events', () => ({
  startWatch: (root: string) => startWatch(root),
  stopWatch: () => stopWatch(),
}));

const openFileByPath = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
const openExternalFile = vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined);
vi.mock('./fileOpenFlow', () => ({
  openFileByPath: (path: string) => openFileByPath(path),
  openExternalFile: (path: string) => openExternalFile(path),
}));

const showToast = vi.fn();
vi.mock('../stores/useToastStore', () => ({
  showToast: (...args: unknown[]) => showToast(...args),
}));

const INFO: VaultInfo = { root: '/v', repoRoot: '/v', name: 'v' };
let view: EditorView;

beforeEach(() => {
  vi.clearAllMocks();
  openVault.mockResolvedValue(INFO);
  project.mockReset().mockResolvedValue(true);
  useProjectStore.setState(useProjectStore.getInitialState(), true);
  useEditorStore.setState({ tabs: [{ path: 'keep.md', name: 'keep.md' }], activePath: 'keep.md', dirty: { 'keep.md': true } });
  view = new EditorView({ state: EditorState.create({ doc: '需要保留的正文' }) }); setView(view);
  useVaultStore.setState(useVaultStore.getInitialState(), true);
});

afterEach(() => {
  view.destroy(); setView(null);
  useVaultStore.setState(useVaultStore.getInitialState(), true);
});

describe('requestOpenFolder（原生目录对话框）', () => {
  it('选中路径交给统一项目入口，目录命令自身不绕过保存协议切watcher或正文', async () => {
    pickFolder.mockResolvedValue('/v');
    await requestOpenFolder();
    expect(project).toHaveBeenCalledWith('/v');
    expect(stopWatch).not.toHaveBeenCalled(); expect(startWatch).not.toHaveBeenCalled(); expect(openVault).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe('需要保留的正文');
    expect(useEditorStore.getState().dirty['keep.md']).toBe(true);
  });

  it('取消（null）：no-op，不触碰 watcher / open_vault', async () => {
    pickFolder.mockResolvedValue(null);
    await requestOpenFolder();
    expect(openVault).not.toHaveBeenCalled();
    expect(stopWatch).not.toHaveBeenCalled();
    expect(startWatch).not.toHaveBeenCalled();
  });

  it('项目入口失败保留其可见错误和当前正文，不产生未处理拒绝', async () => {
    pickFolder.mockResolvedValue('/bad');
    project.mockImplementation(async () => {
      useProjectStore.setState({ error: '无法打开目标项目，当前项目保留', archiveOpen: true });
      throw new Error('fixture project failure');
    });
    await expect(requestOpenFolder()).resolves.toBeUndefined();
    expect(useProjectStore.getState()).toMatchObject({ error: '无法打开目标项目，当前项目保留', archiveOpen: true });
    expect(view.state.doc.toString()).toBe('需要保留的正文');
    expect(useEditorStore.getState()).toMatchObject({ activePath: 'keep.md', dirty: { 'keep.md': true } });
    expect(stopWatch).not.toHaveBeenCalled(); expect(openVault).not.toHaveBeenCalled();
  });
});

describe('requestOpenFile（原生文件对话框）', () => {
  it('选中文件 → openExternalFile（库内相对/库外 external 的分流在其内部，#5.1 不切工作区）', async () => {
    useVaultStore.getState().openVault(INFO, []);
    pickFile.mockResolvedValue('/other/c.md');
    await requestOpenFile();
    expect(openExternalFile).toHaveBeenCalledWith('/other/c.md');
    // requestOpenFile 自身不再切 vault——库外文件由 openExternalFile 开成 external tab。
    expect(openVault).not.toHaveBeenCalled();
    expect(stopWatch).not.toHaveBeenCalled();
  });

  it('取消（null）：no-op', async () => {
    pickFile.mockResolvedValue(null);
    await requestOpenFile();
    expect(openExternalFile).not.toHaveBeenCalled();
  });
});

describe('requestOpenRecent', () => {
  it('无最近项：提示，不切 vault', async () => {
    await requestOpenRecent();
    expect(showToast).toHaveBeenCalledWith('warning', expect.stringContaining('还没有最近'));
    expect(openVault).not.toHaveBeenCalled();
  });

  it('恰好一个最近项：直接重开', async () => {
    useVaultStore.getState().pushRecent('/r');
    await requestOpenRecent();
    expect(project).toHaveBeenCalledWith('/r');
    expect(openVault).not.toHaveBeenCalled();
  });

  it('多个最近项：提示去子菜单/侧栏选', async () => {
    useVaultStore.getState().pushRecent('/r1');
    useVaultStore.getState().pushRecent('/r2');
    await requestOpenRecent();
    expect(openVault).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('warning', expect.stringContaining('最近打开'));
  });
});
