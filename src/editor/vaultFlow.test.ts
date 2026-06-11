import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestOpenFolder } from './vaultFlow';
import { useVaultStore } from '../stores/useVaultStore';
import type { VaultInfo } from '../types/vault';

const openFolderDialog = vi.fn<() => Promise<string | null>>();
vi.mock('../stores/useOpenFolderStore', () => ({
  openFolderDialog: () => openFolderDialog(),
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

describe('requestOpenFolder（自绘对话框重写）', () => {
  it('输入路径 → switchVault：停旧 watcher、open_vault、启新 watcher', async () => {
    openFolderDialog.mockResolvedValue('/v');
    await requestOpenFolder();
    expect(stopWatch).toHaveBeenCalledTimes(1);
    expect(openVault).toHaveBeenCalledWith('/v');
    expect(startWatch).toHaveBeenCalledWith('/v');
    expect(useVaultStore.getState().vault?.root).toBe('/v');
  });

  it('对输入路径 trim 后再打开', async () => {
    openFolderDialog.mockResolvedValue('  /v  ');
    await requestOpenFolder();
    expect(openVault).toHaveBeenCalledWith('/v');
  });

  it('取消（null）：no-op，不触碰 watcher / open_vault', async () => {
    openFolderDialog.mockResolvedValue(null);
    await requestOpenFolder();
    expect(openVault).not.toHaveBeenCalled();
    expect(stopWatch).not.toHaveBeenCalled();
    expect(startWatch).not.toHaveBeenCalled();
  });

  it('空白路径：no-op', async () => {
    openFolderDialog.mockResolvedValue('   ');
    await requestOpenFolder();
    expect(openVault).not.toHaveBeenCalled();
    expect(stopWatch).not.toHaveBeenCalled();
  });

  it('打开失败：openVaultByPath 弹错误 toast，不抛出未处理拒绝', async () => {
    openFolderDialog.mockResolvedValue('/bad');
    openVault.mockRejectedValue(new Error('boom'));
    await expect(requestOpenFolder()).resolves.toBeUndefined();
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('无法打开'));
  });
});
