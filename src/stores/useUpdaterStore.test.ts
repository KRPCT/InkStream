import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdaterStore } from './useUpdaterStore';

const checkForUpdate = vi.fn();
const installPending = vi.fn();
const relaunchApp = vi.fn();
vi.mock('../ipc/updater', () => ({
  checkForUpdate: () => checkForUpdate(),
  installPending: (cb: (d: number, t: number | null) => void) => installPending(cb),
  relaunchApp: () => relaunchApp(),
}));
const showToast = vi.fn();
vi.mock('./useToastStore', () => ({ showToast: (...a: unknown[]) => showToast(...a) }));

const s = () => useUpdaterStore.getState();

beforeEach(() => {
  useUpdaterStore.setState(useUpdaterStore.getInitialState(), true);
  [checkForUpdate, installPending, relaunchApp, showToast].forEach((m) => m.mockReset());
});

describe('useUpdaterStore', () => {
  it('checkSilent 有更新 → available + 开对话框，静默无 toast', async () => {
    checkForUpdate.mockResolvedValue({ status: 'update', version: '1.2.0' });
    await s().checkSilent();
    expect(s().status).toBe('available');
    expect(s().version).toBe('1.2.0');
    expect(s().dialogOpen).toBe(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('checkSilent 无更新 / 出错 → 静默（不开对话框、不 toast）', async () => {
    checkForUpdate.mockResolvedValue({ status: 'none' });
    await s().checkSilent();
    expect(s().dialogOpen).toBe(false);
    checkForUpdate.mockResolvedValue({ status: 'error' });
    await s().checkSilent();
    expect(s().dialogOpen).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('checkManual 无更新 → toast 已是最新', async () => {
    checkForUpdate.mockResolvedValue({ status: 'none' });
    await s().checkManual();
    expect(showToast).toHaveBeenCalledWith('warning', '已是最新版本。');
    expect(s().status).toBe('idle');
  });

  it('checkManual 出错 → toast 检查失败（区别于已是最新）', async () => {
    checkForUpdate.mockResolvedValue({ status: 'error' });
    await s().checkManual();
    expect(showToast).toHaveBeenCalledWith('error', expect.stringContaining('检查更新失败'));
    expect(s().status).toBe('idle');
  });

  it('install 进度推进至 ready', async () => {
    installPending.mockImplementation(async (cb: (d: number, t: number | null) => void) => {
      cb(50, 100);
      cb(100, 100);
    });
    await s().install();
    expect(s().status).toBe('ready');
    expect(s().progress).toBe(1);
  });

  it('install 失败 → error + toast（对话框留存供重试）', async () => {
    useUpdaterStore.setState({ dialogOpen: true });
    installPending.mockRejectedValue(new Error('boom'));
    await s().install();
    expect(s().status).toBe('error');
    expect(s().dialogOpen).toBe(true);
    expect(showToast).toHaveBeenCalledWith('error', expect.any(String));
  });

  it('closeDialog 复位 transient 态；下载中不可关', () => {
    useUpdaterStore.setState({ dialogOpen: true, status: 'error', progress: 0.5 });
    s().closeDialog();
    expect(s().dialogOpen).toBe(false);
    expect(s().status).toBe('idle');
    expect(s().progress).toBe(0);

    useUpdaterStore.setState({ dialogOpen: true, status: 'downloading', progress: 0.5 });
    s().closeDialog();
    expect(s().dialogOpen).toBe(true);
  });
});
