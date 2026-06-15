import { beforeEach, describe, expect, it, vi } from 'vitest';

const listDir = vi.fn();
const readFile = vi.fn();
vi.mock('../ipc/vault', () => ({ listDir: (...a: unknown[]) => listDir(...a) }));
vi.mock('../ipc/files', () => ({ readFile: (...a: unknown[]) => readFile(...a) }));

const { buildCodex } = await import('./codex');

beforeEach(() => {
  listDir.mockReset();
  readFile.mockReset();
});

describe('buildCodex（CREA-02）', () => {
  it('解析 type/name/aliases/summary；缺 type 或 name 丢弃；点开头跳过；summary 缺取正文首段', async () => {
    listDir.mockResolvedValue([
      { name: '林深.md', isDir: false },
      { name: '码头.md', isDir: false },
      { name: '无效.md', isDir: false }, // 缺 type → 丢弃
      { name: '.hidden.md', isDir: false }, // 点开头跳过
      { name: 'sub', isDir: true }, // 目录跳过
    ]);
    readFile.mockImplementation((_root: string, rel: string) => {
      if (rel === 'Codex/林深.md')
        return Promise.resolve(
          '---\ntype: character\nname: 林深\naliases: 小林, 深哥\nsummary: 主角\n---\n正文',
        );
      if (rel === 'Codex/码头.md')
        return Promise.resolve('---\ntype: location\nname: 港口码头\n---\n夜里很冷。\n\n第二段');
      if (rel === 'Codex/无效.md') return Promise.resolve('---\nname: 缺type\n---\nx');
      return Promise.resolve('');
    });

    const entries = await buildCodex('/v');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      path: 'Codex/林深.md',
      type: 'character',
      name: '林深',
      aliases: ['小林', '深哥'],
      summary: '主角',
    });
    expect(entries[1]).toEqual({
      path: 'Codex/码头.md',
      type: 'location',
      name: '港口码头',
      aliases: [],
      summary: '夜里很冷。', // 无 summary 字段 → 正文首段
    });
  });

  it('无 Codex/ 文件夹（listDir 抛错）→ []', async () => {
    listDir.mockRejectedValue(new Error('no dir'));
    expect(await buildCodex('/v')).toEqual([]);
  });
});
