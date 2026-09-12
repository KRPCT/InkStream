import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { IndexScope } from '../types/index';
import type { VaultInfo } from '../types/vault';
export { indexDbUrl } from './indexLocation';

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
  const projectId = 'projectId' in vault && typeof vault.projectId === 'string' ? vault.projectId : undefined;
  if (vaultOwner !== vault || captured?.root !== vault.root || captured?.projectId !== projectId) {
    vaultOwner = vault;
    captured = Object.freeze({ root: vault.root, sessionId: crypto.randomUUID(), ...(projectId ? { projectId } : {}) });
  }
  return captured;
}

export function isCurrentIndexScope(scope: IndexScope): boolean {
  const now = captureIndexScope();
  return now?.root === scope.root && now.sessionId === scope.sessionId && now.projectId === scope.projectId;
}

export function resetIndexScope(): void {
  vaultOwner = null;
  captured = null;
}
