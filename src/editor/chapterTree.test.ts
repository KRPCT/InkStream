import { beforeEach, describe, expect, it, vi } from 'vitest';

const listDir = vi.fn();
const readFile = vi.fn();
vi.mock('../ipc/vault', () => ({ listDir: (...a: unknown[]) => listDir(...a) }));
vi.mock('../ipc/files', () => ({ readFile: (...a: unknown[]) => readFile(...a) }));

const { buildChapterTree } = await import('./chapterTree');

beforeEach(() => {
  listDir.mockReset();
  readFile.mockReset();
});

describe('buildChapterTree（CREA-01）', () => {
  it('文件夹=章 / 文件=场景；title/status + 字数；缺省 draft；隐藏点目录；散文件归未分章', async () => {
    listDir.mockImplementation((_root: string, rel: string) => {
      if (rel === '')
        return Promise.resolve([
          { name: '.git', isDir: true }, // 隐藏
          { name: '第一章', isDir: true },
          { name: '番外.md', isDir: false }, // 顶层散场景 → 未分章
        ]);
      if (rel === '第一章')
        return Promise.resolve([
          { name: '场景1.md', isDir: false },
          { name: '场景2.md', isDir: false },
        ]);
      return Promise.resolve([]);
    });
    readFile.mockImplementation((_root: string, rel: string) => {
      if (rel === '第一章/场景1.md')
        return Promise.resolve('---\ntitle: 雨夜\nstatus: final\n---\n一二三');
      if (rel === '第一章/场景2.md') return Promise.resolve('正文 abc'); // 无 frontmatter → draft
      if (rel === '番外.md') return Promise.resolve('---\nstatus: revised\n---\nxx yy zz');
      return Promise.resolve('');
    });

    const chapters = await buildChapterTree('/v');

    expect(chapters.map((c) => c.name)).toEqual(['第一章', '未分章']);
    expect(chapters[0].scenes[0]).toEqual({
      path: '第一章/场景1.md',
      name: '雨夜', // frontmatter title 优先
      status: 'final',
      words: 3, // 一 二 三
    });
    expect(chapters[0].scenes[1]).toEqual({
      path: '第一章/场景2.md',
      name: '场景2', // 无 title → 文件名去 .md
      status: 'draft', // 缺省
      words: 3, // 正 文 abc
    });
    expect(chapters[1]).toEqual({
      name: '未分章',
      path: null,
      scenes: [{ path: '番外.md', name: '番外', status: 'revised', words: 3 }],
    });
  });

  it('读盘失败的场景回退（不阻断整树）', async () => {
    listDir.mockImplementation((_root: string, rel: string) =>
      Promise.resolve(rel === '' ? [{ name: 'a.md', isDir: false }] : []),
    );
    readFile.mockRejectedValue(new Error('boom'));
    const chapters = await buildChapterTree('/v');
    expect(chapters[0].scenes[0]).toEqual({ path: 'a.md', name: 'a', status: 'draft', words: 0 });
  });
});
