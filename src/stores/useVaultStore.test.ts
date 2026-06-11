import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVaultStore } from './useVaultStore';
import type { TreeNode, VaultInfo } from '../types/vault';

const VAULT: VaultInfo = { root: '/v', repoRoot: null, name: 'v' };
const TREE: TreeNode[] = [{ id: 'a.md', name: 'a.md', isDir: false }];

function reset(): void {
  useVaultStore.setState({
    vault: null,
    tree: [],
    files: [],
    expanded: new Set(),
    recentVaults: [],
    lastVaultPath: null,
  });
}

describe('useVaultStore', () => {
  beforeEach(reset);

  it('openVault sets current vault and tree', () => {
    useVaultStore.getState().openVault(VAULT, TREE);
    const s = useVaultStore.getState();
    expect(s.vault).toEqual(VAULT);
    expect(s.tree).toEqual(TREE);
  });

  it('clearVault resets vault, tree and expanded', () => {
    useVaultStore.getState().openVault(VAULT, TREE);
    useVaultStore.getState().toggleExpanded('a.md');
    useVaultStore.getState().clearVault();
    const s = useVaultStore.getState();
    expect(s.vault).toBeNull();
    expect(s.tree).toEqual([]);
    expect(s.expanded.size).toBe(0);
  });

  it('toggleExpanded flips a path in the expanded set', () => {
    useVaultStore.getState().toggleExpanded('dir');
    expect(useVaultStore.getState().expanded.has('dir')).toBe(true);
    useVaultStore.getState().toggleExpanded('dir');
    expect(useVaultStore.getState().expanded.has('dir')).toBe(false);
  });

  it('pushRecent：最近列表去重 + 置顶 + 上限截断（≤20）', () => {
    useVaultStore.getState().pushRecent('/a');
    useVaultStore.getState().pushRecent('/b');
    useVaultStore.getState().pushRecent('/a'); // 重复置顶
    expect(useVaultStore.getState().recentVaults).toEqual(['/a', '/b']);
    for (let i = 0; i < 25; i++) useVaultStore.getState().pushRecent(`/x${i}`);
    expect(useVaultStore.getState().recentVaults).toHaveLength(20);
    expect(useVaultStore.getState().recentVaults[0]).toBe('/x24');
  });

  it('setLastVaultPath 记录上次 vault 路径（D-07 启动恢复）', () => {
    useVaultStore.getState().setLastVaultPath('/v');
    expect(useVaultStore.getState().lastVaultPath).toBe('/v');
  });

  it('hydratePersisted 应用持久态（最近 + 上次路径 + 展开）', () => {
    useVaultStore.getState().hydratePersisted({
      recentVaults: ['/v', '/w'],
      lastVaultPath: '/v',
      expandedForVault: ['notes', 'src'],
    });
    const s = useVaultStore.getState();
    expect(s.recentVaults).toEqual(['/v', '/w']);
    expect(s.lastVaultPath).toBe('/v');
    expect(s.expanded.has('notes')).toBe(true);
  });

  it('store holds no EditorView/EditorState instance fields', () => {
    const keys = Object.keys(useVaultStore.getState());
    expect(keys).not.toContain('view');
    expect(keys).not.toContain('editorState');
  });
});

describe('switchVault (vaultFlow watch lifecycle)', () => {
  const openVaultIpc = vi.fn();
  const listDir = vi.fn().mockResolvedValue([]);
  const listFiles = vi.fn().mockResolvedValue([]);
  const startWatch = vi.fn().mockResolvedValue(null);
  const stopWatch = vi.fn().mockResolvedValue(null);
  const findRepoRoot = vi.fn().mockResolvedValue('/v');

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    reset();
    vi.doMock('../ipc/vault', () => ({
      openVault: (p: string) => openVaultIpc(p),
      listDir: (...a: unknown[]) => listDir(...a),
      listFiles: (...a: unknown[]) => listFiles(...a),
      findRepoRoot: (...a: unknown[]) => findRepoRoot(...a),
    }));
    vi.doMock('../ipc/events', () => ({
      startWatch: (...a: unknown[]) => startWatch(...a),
      stopWatch: (...a: unknown[]) => stopWatch(...a),
    }));
  });

  afterEach(() => {
    vi.doUnmock('../ipc/vault');
    vi.doUnmock('../ipc/events');
    vi.resetModules();
  });

  it('切 vault：stop_watch 旧 + open_vault 新 + start_watch 新（D-07 单窗单 vault）', async () => {
    openVaultIpc.mockImplementation((p: string) =>
      Promise.resolve({ root: p, repoRoot: p, name: p.slice(1) }),
    );
    const { switchVault } = await import('../editor/vaultFlow');
    await switchVault('/v');
    expect(stopWatch).toHaveBeenCalled();
    expect(openVaultIpc).toHaveBeenCalledWith('/v');
    expect(startWatch).toHaveBeenCalledWith('/v');
    expect(useVaultStore.getState().vault?.root).toBe('/v');
    expect(useVaultStore.getState().recentVaults).toContain('/v');
  });
});
