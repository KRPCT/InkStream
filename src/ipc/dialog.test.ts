import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';
import { pickFile, pickFolder } from './dialog';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

const mockedOpen = vi.mocked(open);

describe('dialog ipc 收口', () => {
  beforeEach(() => {
    mockedOpen.mockReset();
  });

  it('pickFolder：directory + 单选，返回选中路径', async () => {
    mockedOpen.mockResolvedValue('/v');
    await expect(pickFolder()).resolves.toBe('/v');
    expect(mockedOpen).toHaveBeenCalledWith({ directory: true, multiple: false });
  });

  it('pickFolder 取消返回 null', async () => {
    mockedOpen.mockResolvedValue(null);
    await expect(pickFolder()).resolves.toBeNull();
  });

  it('pickFile：非目录 + 单选 + Markdown 过滤', async () => {
    mockedOpen.mockResolvedValue('/v/a.md');
    await expect(pickFile()).resolves.toBe('/v/a.md');
    expect(mockedOpen).toHaveBeenCalledWith({
      directory: false,
      multiple: false,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    });
  });

  it('pickFile 取消返回 null', async () => {
    mockedOpen.mockResolvedValue(null);
    await expect(pickFile()).resolves.toBeNull();
  });
});
