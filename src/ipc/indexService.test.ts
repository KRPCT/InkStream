import { beforeEach, describe, expect, it, vi } from 'vitest';

const select = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: vi.fn(async () => ({ select })) },
}));

import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import { indexDbUrl, isIndexable, queryContent, queryContentPaths } from './indexService';

/** 索引库连接串构造（Phase 4 W4 修：剥 Windows \\?\ 扩展前缀，反链恒空真因回归门）。 */
describe('indexDbUrl', () => {
  it('剥除 Windows 扩展长度前缀 \\\\?\\（真机 vault 根的真实形态）', () => {
    expect(indexDbUrl('\\\\?\\D:\\InkStreamTestVault')).toBe(
      'sqlite:D:/InkStreamTestVault/.inkstream/index.db',
    );
  });

  it('剥除 UNC 扩展前缀 \\\\?\\UNC\\ 还原为 \\\\', () => {
    expect(indexDbUrl('\\\\?\\UNC\\server\\share\\vault')).toBe(
      'sqlite://server/share/vault/.inkstream/index.db',
    );
  });

  it('普通 Windows 路径：仅反斜杠归一', () => {
    expect(indexDbUrl('D:\\vault')).toBe('sqlite:D:/vault/.inkstream/index.db');
  });

  it('已是正斜杠（POSIX）原样', () => {
    expect(indexDbUrl('/home/u/vault')).toBe('sqlite:/home/u/vault/.inkstream/index.db');
  });
});

describe('isIndexable', () => {
  it('仅 .md 进索引', () => {
    expect(isIndexable('a/b.md')).toBe(true);
    expect(isIndexable('a/b.txt')).toBe(false);
    expect(isIndexable('a/b.markdown')).toBe(false);
  });
});

describe('queryContent', () => {
  beforeEach(() => {
    select.mockReset();
    useSettingsStore.setState({ simpleMode: false });
    useVaultStore.setState({ vault: { root: 'D:/v', repoRoot: null, name: 'v' }, files: [] });
  });

  it('简易模式不触库，返空', async () => {
    useSettingsStore.setState({ simpleMode: true });
    expect(await queryContent('研究方法')).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('短查询（<3 字 trigram 下限）不触库，返空', async () => {
    expect(await queryContent('研')).toEqual([]);
    expect(await queryContent('ab')).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('查询词作短语量子化（双引号包裹），结果折叠空白成单行', async () => {
    select.mockResolvedValue([{ path: '笔记/a.md', snippet: '前文  研究方法\n 与数据' }]);
    const hits = await queryContent('研究方法');
    expect(select).toHaveBeenCalledWith(expect.any(String), ['"研究方法"']);
    expect(hits).toEqual([{ path: '笔记/a.md', snippet: '前文 研究方法 与数据' }]);
  });

  it('内嵌双引号转义为两个双引号', async () => {
    select.mockResolvedValue([]);
    await queryContent('a"b"c');
    expect(select).toHaveBeenCalledWith(expect.any(String), ['"a""b""c"']);
  });

  it('查询失败弃连接返空，不抛', async () => {
    select.mockRejectedValue(new Error('db gone'));
    await expect(queryContent('研究方法')).resolves.toEqual([]);
  });
});

describe('queryContentPaths', () => {
  beforeEach(() => {
    select.mockReset();
    useSettingsStore.setState({ simpleMode: false });
    useVaultStore.setState({ vault: { root: 'D:/v', repoRoot: null, name: 'v' }, files: [] });
  });

  it('简易模式 / 短词不触库，返空', async () => {
    useSettingsStore.setState({ simpleMode: true });
    expect(await queryContentPaths('研究方法')).toEqual([]);
    useSettingsStore.setState({ simpleMode: false });
    expect(await queryContentPaths('研')).toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it('短语量子化 + LIMIT 内联默认 500，返回路径名单', async () => {
    select.mockResolvedValue([{ path: 'a.md' }, { path: 'b.md' }]);
    const paths = await queryContentPaths('研究方法');
    expect(paths).toEqual(['a.md', 'b.md']);
    const [sql, params] = select.mock.calls[0];
    expect(sql).toContain('LIMIT 500');
    expect(params).toEqual(['"研究方法"']);
  });

  it('自定义 limit floor 后内联', async () => {
    select.mockResolvedValue([]);
    await queryContentPaths('研究方法', 42.9);
    expect(select.mock.calls[0][0]).toContain('LIMIT 42');
  });
});
