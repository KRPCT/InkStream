import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openUrl } from '@tauri-apps/plugin-opener';
import { openExternal } from './opener';

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const mockedOpenUrl = vi.mocked(openUrl);

describe('openExternal', () => {
  beforeEach(() => {
    mockedOpenUrl.mockClear();
  });

  it.each([
    'https://example.com',
    'https://example.com/path?q=1#frag',
    'http://example.com',
  ])('opens allowed scheme via opener: %s', async (url) => {
    await openExternal(url);
    expect(mockedOpenUrl).toHaveBeenCalledTimes(1);
    expect(mockedOpenUrl).toHaveBeenCalledWith(url);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'file:///C:/Windows/System32/config/SAM',
    'vbscript:msgbox(1)',
    'mailto:user@example.com',
  ])('rejects disallowed scheme without opening: %s', async (url) => {
    await openExternal(url);
    expect(mockedOpenUrl).not.toHaveBeenCalled();
  });

  it.each(['', 'not a url', '://missing-scheme', 'example.com'])(
    'swallows malformed url without opening: %s',
    async (url) => {
      await expect(openExternal(url)).resolves.toBeUndefined();
      expect(mockedOpenUrl).not.toHaveBeenCalled();
    }
  );
});
