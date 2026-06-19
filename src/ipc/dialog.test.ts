import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open, save } from '@tauri-apps/plugin-dialog';
import { pickFile, pickFolder, pickSavePath } from './dialog';

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

const mockedOpen = vi.mocked(open);
const mockedSave = vi.mocked(save);

describe('dialog ipc 收口', () => {
  beforeEach(() => {
    mockedOpen.mockReset();
    mockedSave.mockReset();
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

  it('pickFile：非目录 + 单选 + 可打开文档过滤（含阅读格式）', async () => {
    mockedOpen.mockResolvedValue('/v/a.md');
    await expect(pickFile()).resolves.toBe('/v/a.md');
    expect(mockedOpen).toHaveBeenCalledWith({
      directory: false,
      multiple: false,
      filters: [
        { name: '可打开文档', extensions: ['md', 'markdown', 'txt', 'docx', 'epub', 'pdf'] },
      ],
    });
  });

  it('pickFile 取消返回 null', async () => {
    mockedOpen.mockResolvedValue(null);
    await expect(pickFile()).resolves.toBeNull();
  });

  it('pickSavePath：预填默认文件名 + Markdown 过滤（草稿另存为）', async () => {
    mockedSave.mockResolvedValue('/v/未命名-1.md');
    await expect(pickSavePath('未命名-1.md')).resolves.toBe('/v/未命名-1.md');
    expect(mockedSave).toHaveBeenCalledWith({
      defaultPath: '未命名-1.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }],
    });
  });

  it('pickSavePath 取消返回 null', async () => {
    mockedSave.mockResolvedValue(null);
    await expect(pickSavePath('未命名-1.md')).resolves.toBeNull();
  });
});
