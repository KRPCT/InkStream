import { useIndexStore } from '../stores/useIndexStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import { captureIndexScope, isIndexScopePaused, suspendIndexScope } from './indexScope';
import { ensureIndexReady, quiesceIndexSession } from './indexSession';
import type { VaultInfo } from '../types/vault';

const quiescing = new WeakMap<VaultInfo, Promise<void>>();

/** Retire pending reads/writes, then resume once with a fresh token and an actual disk rebuild. */
export async function pauseIndexSession(root: string): Promise<() => Promise<null>> {
  const vault = useVaultStore.getState().vault;
  if (!vault || vault.root !== root) throw new Error('索引暂停请求不属于当前工作区');
  const old = captureIndexScope();
  const release = suspendIndexScope(vault);
  useIndexStore.setState({ scope: null, status: useSettingsStore.getState().simpleMode ? 'disabled' : 'preparing', error: null });
  let resumed: Promise<null> | null = null;
  const resume = (): Promise<null> => {
    if (resumed) return resumed;
    resumed = (async () => {
      release();
      if (isIndexScopePaused(vault)) return null;
      quiescing.delete(vault);
      if (useVaultStore.getState().vault !== vault) return null;
      const scope = captureIndexScope();
      if (!scope) { useIndexStore.setState({ scope: null, status: 'disabled', error: null }); return null; }
      return ensureIndexReady(scope);
    })();
    return resumed;
  };
  try {
    let closed = quiescing.get(vault);
    if (!closed) { closed = quiesceIndexSession(root, old); quiescing.set(vault, closed); }
    await closed;
    return resume;
  } catch (error) {
    // A failed pause never leaves admission permanently suspended; report the original failure.
    try { await resume(); } catch { /* ensureIndexReady owns the current error state. */ }
    throw error;
  }
}
