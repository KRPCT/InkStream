import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestOpenFile, requestOpenFolder, requestOpenRecent } from './vaultFlow';
import { useVaultStore } from '../stores/useVaultStore';
import type { VaultInfo } from '../types/vault';

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
vi.mock('./fileOpenFlow', () => ({
  openFileByPath: (path: string) => openFileByPath(path),
}));

const showToast = vi.fn();
vi.mock('../stores/useToastStore', () => ({
  showToast: (...args: unknown[]) => showToast(...args),
}));

const INFO: VaultInfo = { root: '/v', repoRoot: '/v', name: 'v' };

beforeEach(() => {
  vi.clearAllMocks();
  openVault.mockResolvedValue(INFO);
  useVaultStore.setState(useVaultStore.getInitialState(), true);
});

afterEach(() => {
  useVaultStore.setState(useVaultStore.getInitialState(), true);
});

describe('requestOpenFolder（原生目录对话框）', () => {
  it('选中路径 → switchVault：停旧 watcher、open_vault、启新 watcher', async () => {
    pickFolder.mockResolvedValue('/v');
    await requestOpenFolder();
    expect(stopWatch).toHaveBeenCalledTimes(1);
    expect(openVault).toHaveBeenCalledWith('/v');
    expect(startWatch).toHaveBeenCalledWith('/v');
    expect(useVaultStore.getState().vault?.root).toBe('/v');
  });

  it('取消（null）：no-op，不触碰 watcher / open_vault', async () => {
    pickFolder.mockResolvedValue(null);
    await requestOpenFolder();
    expect(openVault).not.toHaveBeenCalled();
    expect(stopWatch).not.toHaveBeenCalled();
    expect(startWatch).not.toHaveBeenCalled();
  });

  it('打开失败：openVaultByPath 弹错误 toast，不抛出未处理拒绝', async () => {
    pickFolder.mockResolvedValue('/bad');
    openVault.mockRejectedValue(new Error('boom'));
    await expect(requestOpenFolder()).resolves.toBeUndefined();
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('无法打开'));
  });
});

describe('requestOpenFile（原生文件对话框）', () => {
  it('vault 内文件：直接按相对路径打开，不切 vault', async () => {
    openVault.mockResolvedValue(INFO);
    useVaultStore.getState().openVault(INFO, []);
    pickFile.mockResolvedValue('/v/notes/a.md');
    await requestOpenFile();
    expect(openVault).not.toHaveBeenCalled();
    expect(stopWatch).not.toHaveBeenCalled();
    expect(openFileByPath).toHaveBeenCalledWith('notes/a.md');
  });

  it('Windows 反斜杠路径在 vault 内：归一为正斜杠相对路径', async () => {
    const winInfo: VaultInfo = { root: 'D:\\Notes', repoRoot: null, name: 'Notes' };
    useVaultStore.getState().openVault(winInfo, []);
    pickFile.mockResolvedValue('D:\\Notes\\sub\\b.md');
    await requestOpenFile();
    expect(openFileByPath).toHaveBeenCalledWith('sub/b.md');
  });

  it('vault 外文件：切到父目录作 vault，再按文件名打开', async () => {
    useVaultStore.getState().openVault(INFO, []);
    pickFile.mockResolvedValue('/other/c.md');
    await requestOpenFile();
    expect(stopWatch).toHaveBeenCalledTimes(1);
    expect(openVault).toHaveBeenCalledWith('/other');
    expect(openFileByPath).toHaveBeenCalledWith('c.md');
  });

  it('无 vault：以选中文件父目录作 vault 并打开', async () => {
    pickFile.mockResolvedValue('/fresh/d.md');
    await requestOpenFile();
    expect(openVault).toHaveBeenCalledWith('/fresh');
    expect(openFileByPath).toHaveBeenCalledWith('d.md');
  });

  it('取消（null）：no-op', async () => {
    pickFile.mockResolvedValue(null);
    await requestOpenFile();
    expect(openVault).not.toHaveBeenCalled();
    expect(openFileByPath).not.toHaveBeenCalled();
  });

  it('切 vault 失败：不再尝试打开文件（避免对失败 vault 读文件）', async () => {
    pickFile.mockResolvedValue('/other/e.md');
    openVault.mockRejectedValue(new Error('boom'));
    await expect(requestOpenFile()).resolves.toBeUndefined();
    expect(openFileByPath).not.toHaveBeenCalled();
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
    expect(openVault).toHaveBeenCalledWith('/r');
  });

  it('多个最近项：提示去子菜单/侧栏选', async () => {
    useVaultStore.getState().pushRecent('/r1');
    useVaultStore.getState().pushRecent('/r2');
    await requestOpenRecent();
    expect(openVault).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('warning', expect.stringContaining('最近打开'));
  });
});
