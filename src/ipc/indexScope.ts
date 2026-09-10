import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { IndexScope } from '../types/index';
import type { VaultInfo } from '../types/vault';

let vaultOwner: VaultInfo | null = null;
let captured: IndexScope | null = null;
const pauses = new WeakMap<VaultInfo, number>();

export function isIndexScopePaused(vault: VaultInfo | null): boolean {
  return vault !== null && (pauses.get(vault) ?? 0) > 0;
}

/** Pauses belong to one vault object, so releasing an old pause never rotates another workspace's token. */
export function suspendIndexScope(vault: VaultInfo): () => void {
  pauses.set(vault, (pauses.get(vault) ?? 0) + 1);
  if (vaultOwner === vault) resetIndexScope();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (pauses.get(vault) ?? 1) - 1;
    if (remaining > 0) pauses.set(vault, remaining);
    else {
      pauses.delete(vault);
      if (useVaultStore.getState().vault === vault) resetIndexScope();
    }
  };
}

/** 每次目录对象生命周期/重新启用都有新token；旧Promise持有的快照永不变成新库权限。 */
export function captureIndexScope(): IndexScope | null {
  const vault = useVaultStore.getState().vault;
  if (!vault || useSettingsStore.getState().simpleMode || isIndexScopePaused(vault)) {
    resetIndexScope();
    return null;
  }
  if (vaultOwner !== vault || captured?.root !== vault.root) {
    vaultOwner = vault;
    captured = Object.freeze({ root: vault.root, sessionId: crypto.randomUUID() });
  }
  return captured;
}

export function isCurrentIndexScope(scope: IndexScope): boolean {
  const now = captureIndexScope();
  return now?.root === scope.root && now.sessionId === scope.sessionId;
}

export function resetIndexScope(): void {
  vaultOwner = null;
  captured = null;
}

/** 保留Windows/UNC兼容的SQL连接名，也用于精确关闭该池（不关闭其他库）。 */
export function indexDbUrl(root: string): string {
  let path = root;
  if (path.startsWith('\\\\?\\UNC\\')) path = '\\\\' + path.slice(8);
  else if (path.startsWith('\\\\?\\')) path = path.slice(4);
  return `sqlite:${path.split('\\').join('/')}/.inkstream/index.db`;
}
