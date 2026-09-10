import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { IndexScope } from '../types/index';
import type { VaultInfo } from '../types/vault';

let vaultOwner: VaultInfo | null = null;
let captured: IndexScope | null = null;

/** 每次目录对象生命周期/重新启用都有新token；旧Promise持有的快照永不变成新库权限。 */
export function captureIndexScope(): IndexScope | null {
  const vault = useVaultStore.getState().vault;
  if (!vault || useSettingsStore.getState().simpleMode) {
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
