import { loadVaultState, saveVaultState } from '../ipc/settings';
import type { PersistedVault } from '../types/vault';
import { useToastStore } from './useToastStore';
import { useVaultStore } from './useVaultStore';
import { validateVault } from './validateVault';

/**
 * vault 级持久化管线（D-08 按 vault 路径键，照 persistSettings 范式）。
 *
 * 启动 loadVaultState → validateVault → 应用最近列表 + 上次路径 + 当前 vault 展开态；
 * 随后订阅 useVaultStore 变更，500ms 防抖合并写盘（应用数据目录，用户仓库零写入）。
 * 持久内容 = 最近 vault + 上次路径 + 按 vault.root 键的展开态。**不含** tab 列表/EditorState
 * （D-03 覆盖 D-08 的「打开的 tab」字面项）。读/写失败仅警告 toast，不中断 UI。
 */

export const DEBOUNCE_MS = 500;

export const VAULT_SAVE_ERROR = '工作区状态保存失败，展开/最近列表在重启后可能丢失。';

let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
/** 上次 load 的全量 expanded 映射（写盘时合并当前 vault 的展开态，保留其它 vault 键）。 */
let expandedByVault: Record<string, string[]> = {};

/** 当前内存态快照（按 vault.root 键合并展开态），写盘前经 validateVault 再过一遍。 */
function snapshot(): PersistedVault {
  const { vault, expanded, recentVaults, lastVaultPath } = useVaultStore.getState();
  const merged = { ...expandedByVault };
  if (vault) merged[vault.root] = [...expanded];
  return validateVault({
    version: 1,
    lastVaultPath: vault?.root ?? lastVaultPath,
    recentVaults,
    expanded: merged,
  });
}

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const snap = snapshot();
    expandedByVault = snap.expanded;
    saveVaultState(snap).catch(() => {
      useToastStore.getState().showToast('warning', VAULT_SAVE_ERROR);
    });
  }, DEBOUNCE_MS);
}

async function doInit(): Promise<void> {
  let data: PersistedVault;
  try {
    data = validateVault(await loadVaultState());
  } catch {
    data = validateVault(null);
  }
  expandedByVault = data.expanded;
  const current = useVaultStore.getState().vault?.root ?? data.lastVaultPath;
  useVaultStore.getState().hydratePersisted({
    recentVaults: data.recentVaults,
    lastVaultPath: data.lastVaultPath,
    expandedForVault: current ? (data.expanded[current] ?? []) : [],
  });
  // 订阅在应用之后建立：hydrate 本身不触发写盘
  unsubscribe = useVaultStore.subscribe(scheduleSave);
}

/** App 启动调用。幂等。 */
export function initVaultPersistence(): Promise<void> {
  initPromise ??= doInit();
  return initPromise;
}

/** 复位管线（测试用）：撤销订阅、取消未落盘的防抖定时器、清内存映射。 */
export function resetVaultPersistence(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  expandedByVault = {};
  initPromise = null;
}
