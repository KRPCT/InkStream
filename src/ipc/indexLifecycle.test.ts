import { beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const select = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const close = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('./invoke', () => ({ invoke: ipc }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: vi.fn(async () => ({ select, close })) } }));

import { useSettingsStore } from '../stores/useSettingsStore';
import { useIndexStore } from '../stores/useIndexStore';
import { useVaultStore } from '../stores/useVaultStore';
import { captureIndexScope, initIndexLifecycle, indexRebuild, indexRemoveDoc, indexSwitchVault, indexUpsertDoc, queryContent, queryGraphData } from './indexService';

function vault(root: string) {
  useVaultStore.setState({ vault: { root, name: root, repoRoot: null }, files: [] });
}

describe('索引写入绑定工作区生命周期', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipc.mockResolvedValue(null);
    select.mockResolvedValue([]);
    useSettingsStore.setState({ simpleMode: false });
    vault('/index-scope-a');
  });

  it('无工作区不得投递正文', async () => {
    useVaultStore.setState({ vault: null });
    await indexUpsertDoc('note.md', '正文');
    expect(ipc).not.toHaveBeenCalled();
  });

  it('简易模式不能写入或删除旧库索引', async () => {
    useSettingsStore.setState({ simpleMode: true });
    await indexUpsertDoc('note.md', '正文');
    await indexRemoveDoc('note.md');
    expect(ipc).not.toHaveBeenCalled();
  });

  it('每次正文请求带所属root和session，同目录重新打开产生新session', async () => {
    await indexUpsertDoc('note.md', 'A');
    const first = ipc.mock.calls.find(([name]) => name === 'index_upsert_doc')?.[1];
    expect(first).toMatchObject({ root: '/index-scope-a', sessionId: expect.any(String) });
    ipc.mockClear();
    vault('/index-scope-a');
    await indexUpsertDoc('note.md', 'B');
    const next = ipc.mock.calls.find(([name]) => name === 'index_upsert_doc')?.[1];
    expect(next).toMatchObject({ root: '/index-scope-a', sessionId: expect.any(String) });
    expect(next.sessionId).not.toBe(first.sessionId);
  });

  it('当前已是B时，不接受旧A的延迟重建请求', async () => {
    vault('/index-scope-b');
    await expect(indexRebuild('/index-scope-a')).rejects.toThrow('工作区');
    expect(ipc).not.toHaveBeenCalled();
  });

  it('准备尚未完成时不把新正文投给尚未就绪的库', async () => {
    let commit!: () => void;
    ipc.mockImplementation((name) => name === 'index_rebuild'
      ? new Promise<null>((resolve) => { commit = () => resolve(null); })
      : Promise.resolve(null));
    const ready = indexRebuild('/index-scope-a');
    const write = indexUpsertDoc('note.md', '新的正文');
    await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
    expect(ipc.mock.calls.some(([name]) => name === 'index_upsert_doc')).toBe(false);
    commit();
    await ready;
    await write;
    expect(ipc.mock.calls.some(([name]) => name === 'index_upsert_doc')).toBe(true);
  });

  it('切库关闭旧只读连接，不能仅丢弃Promise', async () => {
    await queryGraphData();
    vault('/index-scope-b');
    await queryGraphData();
    expect(close).toHaveBeenCalledWith('sqlite:/index-scope-a/.inkstream/index.db');
  });

  it('SQL失败与合法零命中不同，查询明确失败', async () => {
    select.mockRejectedValue(new Error('fixture database unavailable'));
    await expect(queryContent('研究方法')).rejects.toThrow();
  });

  it('显式null及旧scope不能在新工作区取得默认写权限', async () => {
    const old = captureIndexScope();
    vault('/index-scope-b');
    await indexUpsertDoc('note.md', '旧库正文', old);
    await indexUpsertDoc('note.md', '禁写正文', null);
    await indexRemoveDoc('note.md', null);
    expect(ipc).not.toHaveBeenCalled();
  });

  it('同目录简易模式关开后换token，旧回调不能复活', async () => {
    const stop = initIndexLifecycle();
    try {
      await indexSwitchVault('/index-scope-a');
      const old = captureIndexScope();
      useSettingsStore.setState({ simpleMode: true });
      expect(captureIndexScope()).toBeNull();
      useSettingsStore.setState({ simpleMode: false });
      await indexSwitchVault('/index-scope-a');
      expect(captureIndexScope()?.sessionId).not.toBe(old?.sessionId);
      ipc.mockClear();
      await indexUpsertDoc('note.md', '旧权限', old);
      expect(ipc).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it('重建等待此前投递的实际写完成，旧路径写不会排到重建之后', async () => {
    await indexSwitchVault('/index-scope-a');
    ipc.mockClear();
    let commit!: () => void;
    ipc.mockImplementation((name) => name === 'index_upsert_doc'
      ? new Promise<null>((resolve) => { commit = () => resolve(null); })
      : Promise.resolve(null));
    const writing = indexUpsertDoc('old-name.md', '即将改名');
    await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
    const rebuilding = indexRebuild('/index-scope-a');
    await Promise.resolve();
    expect(ipc.mock.calls.some(([name]) => name === 'index_rebuild')).toBe(false);
    commit();
    await writing;
    await rebuilding;
    expect(ipc.mock.calls.map(([name]) => name)).toEqual(['index_upsert_doc', 'index_rebuild']);
  });

  it('同scope重建已完成后，旧连接迟到错误不能污染新索引状态', async () => {
    let failOld!: (error: Error) => void;
    select.mockReturnValueOnce(new Promise((_, reject) => { failOld = reject; }));
    const old = queryContent('旧查询内容').catch(() => {});
    await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    await indexRebuild('/index-scope-a');
    expect(useIndexStore.getState().status).toBe('ready');
    failOld(new Error('old read connection closed'));
    await old;
    expect(useIndexStore.getState().status).toBe('ready');
    expect(useIndexStore.getState().error).toBeNull();
  });
});
