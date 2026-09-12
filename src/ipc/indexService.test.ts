import { beforeEach, describe, expect, it, vi } from 'vitest';

const select = vi.hoisted(() => vi.fn());
const ipc = vi.hoisted(() => vi.fn());
vi.mock('./invoke', () => ({ invoke: ipc }));
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: vi.fn(async () => ({ select, close: vi.fn().mockResolvedValue(true) })) },
}));

import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import { indexDbUrl, isIndexable, queryBacklinkReferences, queryContent, queryContentPaths, queryUnlinkedMentions } from './indexService';
import { readFile } from './files';
import { useIndexStore } from '../stores/useIndexStore';
import { nativeIndexReply } from '../test/indexLocationFixture';
import { bindIndexLocation } from './indexLocation';
import type { IndexScope } from '../types/index';

beforeEach(() => { ipc.mockImplementation(async (command, args) => nativeIndexReply(command, args)); });
vi.mock('./files', () => ({ readFile: vi.fn() }));

/** 索引库连接串构造（Phase 4 W4 修：剥 Windows \\?\ 扩展前缀，反链恒空真因回归门）。 */
describe('indexDbUrl', () => {
  it.each(['sqlite:C:/Users/Alice/AppData/Local/InkStream/indexes/p/index.db', 'sqlite://server/share/app-data/indexes/p/index.db', 'sqlite:/home/u/.local/share/inkstream/indexes/p/index.db'])('原样使用原生位置 %s，不从用户目录构造回退路径', (databaseUrl) => {
    const scope: IndexScope = { root: 'D:/user-content', sessionId: 'test', projectId: 'p' };
    expect(() => indexDbUrl(scope)).toThrow('尚未确认');
    bindIndexLocation(scope, { projectId: 'p', databaseUrl });
    expect(indexDbUrl(scope)).toBe(databaseUrl);
  });
  it('没有位置或项目身份不符时拒绝读库', () => {
    const scope: IndexScope = { root: '/content', sessionId: 'test', projectId: 'p' };
    expect(() => bindIndexLocation(scope, null)).toThrow('没有返回');
    expect(() => bindIndexLocation(scope, { projectId: 'other', databaseUrl: 'sqlite:/app/indexes/other/index.db' })).toThrow('不属于');
    expect(() => indexDbUrl(scope)).toThrow('尚未确认');
  });
});
describe('isIndexable', () => {
  it('与编辑器支持的 Markdown 扩展名一致，保留物理路径大小写', () => {
    expect(isIndexable('a/b.md')).toBe(true);
    expect(isIndexable('a/B.MD')).toBe(true);
    expect(isIndexable('a/b.txt')).toBe(false);
    expect(isIndexable('a/b.markdown')).toBe(true);
    expect(isIndexable('a/b.MarkDown')).toBe(true);
    expect(isIndexable('a/b.md.tmp')).toBe(false);
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

  it('短中文查询走有界字面搜索，而不是误报为空', async () => {
    select.mockResolvedValue([{ path: '研究.md', snippet: '研究方法' }]);
    expect(await queryContent('研')).toEqual([{ path: '研究.md', snippet: '研究方法' }]);
    expect(select.mock.calls[0][1]).toEqual(['研', '研']);
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

  it('查询失败明确报告，不伪装零结果', async () => {
    select.mockRejectedValue(new Error('db gone'));
    await expect(queryContent('研究方法')).rejects.toThrow('索引查询失败');
  });
});

describe('queryContentPaths', () => {
  beforeEach(() => {
    select.mockReset();
    useSettingsStore.setState({ simpleMode: false });
    useVaultStore.setState({ vault: { root: 'D:/v', repoRoot: null, name: 'v' }, files: [] });
  });

  it('简易模式 / 空词不触库，返空', async () => {
    useSettingsStore.setState({ simpleMode: true });
    expect(await queryContentPaths('研究方法')).toEqual([]);
    useSettingsStore.setState({ simpleMode: false });
    expect(await queryContentPaths('')).toEqual([]);
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

describe('queryBacklinkReferences', () => {
  beforeEach(() => {
    select.mockReset();
    useSettingsStore.setState({ simpleMode: false });
    useVaultStore.setState({ vault: { root: 'D:/paragraphs', repoRoot: null, name: 'paragraphs' }, files: [] });
  });

  it('只查询索引身份，正文经文件通道读取；裸名歧义不产生段落引用', async () => {
    const content = '😀[[dup]]、[[b/dup|正确引用]]、[[missing/dup]]。';
    select.mockResolvedValue([
      { path: 'a/dup.md', candidate: 0 },
      { path: 'b/dup.md', candidate: 0 },
      { path: 'source.md', candidate: 1 },
    ]);
    vi.mocked(readFile).mockResolvedValue(content);
    const refs = await queryBacklinkReferences('b/dup.md');
    expect(select).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith('D:/paragraphs', 'source.md', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ sourcePath: 'source.md', context: content, from: content.indexOf('[[b/dup'), linkText: '[[b/dup|正确引用]]' });
  });
});

describe('queryUnlinkedMentions', () => {
  beforeEach(() => {
    select.mockReset(); vi.mocked(readFile).mockReset();
    useSettingsStore.setState({ simpleMode: false });
    useVaultStore.setState({ vault: { root: 'D:/mentions', repoRoot: null, name: 'mentions' }, files: [] });
  });
  it('取消旧查询立即通知Raw读取，不把取消当作索引损坏', async () => {
    select.mockResolvedValue([{ path: '研究.md', candidate: 0 }, { path: 'source.md', candidate: 1 }]);
    let rawSignal: AbortSignal | undefined;
    vi.mocked(readFile).mockImplementation((_root, _path, options) => new Promise((_resolve, reject) => {
      rawSignal = options?.signal;
      rawSignal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    }));
    const controller = new AbortController();
    const pending = queryBacklinkReferences('研究.md', { signal: controller.signal });
    const outcome = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(rawSignal).toBeDefined());
    controller.abort(); await outcome;
    expect(rawSignal?.aborted).toBe(true);
    expect(useIndexStore.getState().status).toBe('ready');
    expect(useIndexStore.getState().error).toBeNull();
  });
  it('来源读取失败明确显示且保留健康索引，不跳过成零引用', async () => {
    select.mockResolvedValue([{ path: '研究.md', candidate: 0 }, { path: 'source.md', candidate: 1 }]);
    vi.mocked(readFile).mockRejectedValue(new Error('fixture read denied'));
    await expect(queryBacklinkReferences('研究.md')).rejects.toThrow('source.md');
    expect(useIndexStore.getState().status).toBe('ready');
  });
  it('双字中文名能找到正文提及，排除代码示例和已有链接', async () => {
    const paths = ['研究.MD', 'prose.markdown', 'code.md', 'linked.md'];
    select.mockImplementation(async (sql: string) => sql.includes('AS candidate')
      ? paths.map((path) => ({ path, candidate: 1 }))
      : sql.includes('FROM links') ? [{ source_path: 'linked.md', target_raw: '研究' }] : paths.map((path) => ({ path })));
    vi.mocked(readFile).mockImplementation(async (_root, path) => path === 'code.md' ? '```md\n研究\n```' : '这是一份研究记录。');
    expect(await queryUnlinkedMentions('研究.MD')).toEqual(['prose.markdown']);
    expect(readFile).not.toHaveBeenCalledWith('D:/mentions', 'linked.md', expect.anything());
  });
  it('同名归属歧义明确报告，不伪造零结果', async () => {
    select.mockResolvedValue([{ path: 'a/研究.md', candidate: 1 }, { path: 'b/研究.md', candidate: 1 }]);
    await expect(queryUnlinkedMentions('a/研究.md')).rejects.toThrow('同名');
    expect(readFile).not.toHaveBeenCalled();
  });
  it('组合与分解 Unicode 都进入候选，Worker按真实正文验证提及', async () => {
    select.mockImplementation(async (sql: string) => sql.includes('AS candidate')
      ? [{ path: 'Café.md', candidate: 0 }, { path: 'source.md', candidate: 1 }]
      : sql.includes('FROM links') ? [] : [{ path: 'Café.md' }, { path: 'source.md' }]);
    vi.mocked(readFile).mockResolvedValue('Cafe\u0301 的研究记录。');
    expect(await queryUnlinkedMentions('Café.md')).toEqual(['source.md']);
    expect(select.mock.calls[0][1]).toEqual(['Café', 'Cafe\u0301']);
  });
});
