import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { loadVaultState, saveVaultState } from '../ipc/settings';
import type { VaultInfo } from '../types/vault';
import {
  DEBOUNCE_MS,
  initVaultPersistence,
  resetVaultPersistence,
} from './persistVault';
import { useEditorStore } from './useEditorStore';
import { useVaultStore } from './useVaultStore';

vi.mock('../ipc/settings', () => ({
  loadVaultState: vi.fn().mockResolvedValue({}),
  saveVaultState: vi.fn().mockResolvedValue(undefined),
}));

const mockLoad = loadVaultState as Mock;
const mockSave = saveVaultState as Mock;

const VAULT: VaultInfo = { root: '/v', repoRoot: null, name: 'v' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mockLoad.mockResolvedValue({});
  mockSave.mockResolvedValue(undefined);
  resetVaultPersistence();
  useVaultStore.setState({
    vault: null,
    tree: [],
    files: [],
    expanded: new Set(),
    recentVaults: [],
    lastVaultPath: null,
  });
  useEditorStore.setState(useEditorStore.getInitialState(), true);
});

afterEach(() => {
  resetVaultPersistence();
  vi.useRealTimers();
});

describe('persistVault', () => {
  it('init：应用持久态到 store（最近列表 + 上次路径）', async () => {
    mockLoad.mockResolvedValue({
      version: 1,
      lastVaultPath: '/v',
      recentVaults: ['/v', '/w'],
      expanded: { '/v': ['notes'] },
    });
    await initVaultPersistence();
    expect(useVaultStore.getState().recentVaults).toEqual(['/v', '/w']);
    expect(useVaultStore.getState().lastVaultPath).toBe('/v');
  });

  it('防抖：500ms 窗口内多次变更只写一次盘', async () => {
    await initVaultPersistence();
    mockSave.mockClear();
    useVaultStore.getState().openVault(VAULT, []);
    useVaultStore.getState().toggleExpanded('notes');
    useVaultStore.getState().toggleExpanded('src');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(mockSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('展开态不持久化（恒写空 expanded 映射保 schema 兼容）', async () => {
    await initVaultPersistence();
    mockSave.mockClear();
    useVaultStore.getState().openVault(VAULT, []);
    useVaultStore.getState().toggleExpanded('notes');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const payload = mockSave.mock.calls[0][0] as {
      lastVaultPath: string;
      expanded: Record<string, string[]>;
    };
    expect(payload.lastVaultPath).toBe('/v');
    // UAT 反馈：恢复的展开目录因懒加载未触发显示为空，且用户要求开 vault 默认全折叠——
    // 会话内展开不落盘；schema 字段保留为空映射（version 1 兼容旧文件）。
    expect(payload.expanded).toEqual({});
  });

  it('持久内容不含 tab 列表 / 编辑状态（D-03 覆盖 D-08 的 tab 字面项）', async () => {
    await initVaultPersistence();
    mockSave.mockClear();
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    useVaultStore.getState().openVault(VAULT, []);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const payload = mockSave.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('tabs');
    expect(payload).not.toHaveProperty('activePath');
    expect(JSON.stringify(payload)).not.toContain('a.md');
  });

  it('写盘内容经 validateVault 再过一遍（内存投毒被钳制）', async () => {
    await initVaultPersistence();
    mockSave.mockClear();
    // 直接注入异常内存态（非字符串混入 recentVaults）
    useVaultStore.setState({
      recentVaults: ['/v', 123 as unknown as string, '/w'],
      lastVaultPath: '/v',
    });
    useVaultStore.getState().toggleExpanded('x');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const payload = mockSave.mock.calls[0][0] as { recentVaults: string[] };
    expect(payload.recentVaults).toEqual(['/v', '/w']);
  });

  it('init 本身不触发写盘（订阅在应用之后建立）', async () => {
    mockLoad.mockResolvedValue({ version: 1, recentVaults: ['/v'], lastVaultPath: '/v' });
    await initVaultPersistence();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
