import { useVaultStore } from '../../stores/useVaultStore';
import type { VaultInfo } from '../../types/vault';
const sessions = new WeakMap<VaultInfo, number>();
let nextSession = 0;
/** A reopened folder is a new workspace session, even if its physical path is unchanged. */
export function useGithubScopeKey(repoRoot: string | null): string {
  const vault = useVaultStore((state) => state.vault);
  if (vault && !sessions.has(vault)) sessions.set(vault, ++nextSession);
  return `${repoRoot ?? ''}:${vault ? sessions.get(vault) : 'none'}`;
}
