import { beforeEach, describe, expect, it, vi } from 'vitest';
const ipc = vi.hoisted(() => vi.fn<(command: string, args?: unknown) => Promise<null>>());
vi.mock('./invoke', () => ({ invoke: ipc }));
import { useIndexStore } from '../stores/useIndexStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import { captureIndexScope, indexRefreshFile, indexSwitchVault } from './indexService';

let generation = 0;
let root: string;
beforeEach(async () => {
  root = `/refresh-contract-${++generation}`;
  useSettingsStore.setState({ simpleMode: false });
  useVaultStore.setState({ vault: { root, name: root, repoRoot: null }, files: [] });
  ipc.mockReset().mockResolvedValue(null);
  await indexSwitchVault(root);
  ipc.mockClear();
});

describe('indexRefreshFile 的scope与提交回执', () => {
  it('只发送scope/path并等待真实提交回执后才增加索引revision', async () => {
    let commit!: () => void;
    ipc.mockImplementation((command) => command === 'index_refresh_file'
      ? new Promise<null>((resolve) => { commit = () => resolve(null); }) : Promise.resolve(null));
    const revision = useIndexStore.getState().revision;
    let finished = false;
    const refresh = indexRefreshFile('目录\\文稿.md').then(() => { finished = true; });
    await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
    expect(ipc).toHaveBeenCalledWith('index_refresh_file', { ...captureIndexScope(), path: '目录/文稿.md' });
    expect(finished).toBe(false);
    expect(useIndexStore.getState().revision).toBe(revision);
    commit();
    await refresh;
    expect(useIndexStore.getState().revision).toBe(revision + 1);
  });

  it('显式null和已过期scope明确拒绝，不借用当前B的权限', async () => {
    const old = captureIndexScope();
    useVaultStore.setState({ vault: { root: `${root}-b`, name: 'B', repoRoot: null } });
    await indexSwitchVault(`${root}-b`);
    ipc.mockClear();
    await expect(indexRefreshFile('note.md', old)).rejects.toThrow(/过期|未启用/);
    await expect(indexRefreshFile('note.md', null)).rejects.toThrow(/过期|未启用/);
    expect(ipc).not.toHaveBeenCalled();
  });

  it('A刷新回执晚到时拒绝旧结果，不增加B的revision或写入error', async () => {
    const old = captureIndexScope();
    let commit!: () => void;
    ipc.mockImplementation((command) => command === 'index_refresh_file'
      ? new Promise<null>((resolve) => { commit = () => resolve(null); }) : Promise.resolve(null));
    const refreshing = indexRefreshFile('note.md', old).catch((error: unknown) => error);
    await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
    useVaultStore.setState({ vault: { root: `${root}-b`, name: 'B', repoRoot: null } });
    await indexSwitchVault(`${root}-b`);
    const revision = useIndexStore.getState().revision;
    commit();
    expect(await refreshing).toBeInstanceOf(Error);
    expect(useIndexStore.getState().revision).toBe(revision);
    expect(useIndexStore.getState().status).toBe('ready');
    expect(useIndexStore.getState().error).toBeNull();
  });
});
