import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../ipc/files', () => ({ readImageBytes: vi.fn() }));
import { readImageBytes } from '../../ipc/files';
import { bytesToDataUri, mimeForUrl, resolveExportImages, scaleToFit } from './imageEmbed';

const mockedRead = vi.mocked(readImageBytes);

beforeEach(() => {
  mockedRead.mockReset();
});

describe('mimeForUrl', () => {
  it('已知图片扩展名 → MIME（大小写无关、剥查询/锚点）', () => {
    expect(mimeForUrl('a.png')).toBe('image/png');
    expect(mimeForUrl('a.JPG')).toBe('image/jpeg');
    expect(mimeForUrl('a.jpeg')).toBe('image/jpeg');
    expect(mimeForUrl('p.webp?v=1')).toBe('image/webp');
    expect(mimeForUrl('i.svg#x')).toBe('image/svg+xml');
  });
  it('无扩展名 / 非图片扩展名 → null（不内嵌）', () => {
    expect(mimeForUrl('noext')).toBeNull();
    expect(mimeForUrl('note.md')).toBeNull();
  });
});

describe('bytesToDataUri', () => {
  it('字节 → base64 data URI', () => {
    expect(bytesToDataUri(new Uint8Array([1, 2, 3]), 'image/png')).toBe(
      'data:image/png;base64,AQID',
    );
  });

  it('跨多个 0x8000 分块的载重字节正确往返（大图不爆栈、不错位）', () => {
    // 分块是该函数存在的唯一理由（避超大数组 spread 爆栈）；用 >2 个分块的数据锁死该不变式。
    const n = 0x8000 * 2 + 123;
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
    const uri = bytesToDataUri(bytes, 'image/png');
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    const decoded = Uint8Array.from(atob(uri.slice('data:image/png;base64,'.length)), (ch) =>
      ch.charCodeAt(0),
    );
    expect(decoded).toEqual(bytes);
  });
});

describe('scaleToFit', () => {
  it('版心内不缩放', () => {
    expect(scaleToFit(100, 50, 600)).toEqual({ width: 100, height: 50 });
    expect(scaleToFit(600, 300, 600)).toEqual({ width: 600, height: 300 });
  });
  it('超宽等比缩到 maxW', () => {
    expect(scaleToFit(1200, 600, 600)).toEqual({ width: 600, height: 300 });
  });
  it('尺寸异常回退 maxW 方图', () => {
    expect(scaleToFit(0, 0, 600)).toEqual({ width: 600, height: 600 });
  });
});

describe('resolveExportImages', () => {
  const vault = { root: 'D:/vault', docPath: 'notes/a.md' };

  it('仅内嵌 vault 内本地图：远程/已 data:/越界/非图片 一律跳过', async () => {
    mockedRead.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const md =
      '![a](pic.png)\n\n![b](https://e.com/r.png)\n\n' +
      '![c](data:image/png;base64,AAAA)\n\n![d](../../etc/secret.png)\n\n![e](note.md)';
    const map = await resolveExportImages(md, vault);
    expect([...map.keys()]).toEqual(['pic.png']);
    expect(map.get('pic.png')).toBe('data:image/png;base64,AQID');
    // 本地图按文档目录解析为 vault 内绝对路径再读盘；非图片扩展名（note.md）绝不读盘。
    expect(mockedRead).toHaveBeenCalledTimes(1);
    expect(mockedRead).toHaveBeenCalledWith('D:/vault/notes/pic.png');
  });

  it('单图读失败不阻断其余图片', async () => {
    mockedRead.mockImplementation(async (p: string) =>
      p.endsWith('bad.png') ? Promise.reject(new Error('io')) : new Uint8Array([9]),
    );
    const map = await resolveExportImages('![x](bad.png)\n\n![y](ok.png)', vault);
    expect([...map.keys()]).toEqual(['ok.png']);
    expect(map.get('ok.png')).toBe('data:image/png;base64,CQ==');
  });

  it('无 vault 上下文：本地图不读盘（远程/data: 仍由渲染层处理）', async () => {
    const map = await resolveExportImages('![x](pic.png)', null);
    expect(map.size).toBe(0);
    expect(mockedRead).not.toHaveBeenCalled();
  });
});
