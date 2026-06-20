import { describe, expect, it, vi } from 'vitest';

const check = vi.fn();
vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => check() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

import { checkForUpdate } from './updater';

describe('ipc/updater.checkForUpdate', () => {
  it('check() 抛错（dev / 非打包 / 无网）→ 降级 status:error，不抛', async () => {
    check.mockImplementation(() => {
      throw new Error('not in a bundled app');
    });
    await expect(checkForUpdate()).resolves.toEqual({ status: 'error' });
  });

  it('check() 返 null（已最新）→ status:none', async () => {
    check.mockResolvedValue(null);
    await expect(checkForUpdate()).resolves.toEqual({ status: 'none' });
  });

  it('check() 返 Update → status:update + version', async () => {
    check.mockResolvedValue({ version: '1.3.0', downloadAndInstall: vi.fn() });
    await expect(checkForUpdate()).resolves.toEqual({ status: 'update', version: '1.3.0' });
  });
});
