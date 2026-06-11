import { beforeEach, describe, expect, it } from 'vitest';
import { useVaultStore } from './useVaultStore';
import type { TreeNode, VaultInfo } from '../types/vault';

const VAULT: VaultInfo = { root: '/v', repoRoot: null, name: 'v' };
const TREE: TreeNode[] = [{ id: 'a.md', name: 'a.md', isDir: false }];

function reset(): void {
  useVaultStore.setState({ vault: null, tree: [], expanded: new Set() });
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

  it('store holds no EditorView/EditorState instance fields', () => {
    const keys = Object.keys(useVaultStore.getState());
    expect(keys).not.toContain('view');
    expect(keys).not.toContain('editorState');
  });
});
