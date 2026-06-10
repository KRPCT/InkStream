import { describe, expect, it } from 'vitest';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { windowControls } from './window';

describe('windowControls', () => {
  it('proxies minimize to the Tauri window', async () => {
    await windowControls.minimize();
    expect(getCurrentWindow().minimize).toHaveBeenCalledTimes(1);
  });

  it('proxies show to the Tauri window', async () => {
    await windowControls.show();
    expect(getCurrentWindow().show).toHaveBeenCalledTimes(1);
  });
});
