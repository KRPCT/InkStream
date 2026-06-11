import type { PersistedVault } from '../types/vault';

/**
 * vault-state.json 读入窄校验（Security V5：手写，不引 zod，永不抛错）。
 * 照 validateSettings：isRecord + 类型守卫 + 缺键补默认；整体异型回空形状。
 *
 * 收敛规则：
 * - recentVaults：过滤非字符串项，上限 20。
 * - expanded：丢弃值非「字符串数组」的键；数组内过滤非字符串项。
 * - lastVaultPath：非空字符串才保留，否则 null。
 */

const RECENT_LIMIT = 20;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function defaults(): PersistedVault {
  return { version: 1, lastVaultPath: null, recentVaults: [], expanded: {} };
}

export const DEFAULT_VAULT_STATE: PersistedVault = defaults();

/** 任意输入（含投毒文件）收敛为合法 PersistedVault，永不抛错。 */
export function validateVault(raw: unknown): PersistedVault {
  if (!isRecord(raw) || raw.version !== 1) return defaults();

  const lastVaultPath =
    typeof raw.lastVaultPath === 'string' && raw.lastVaultPath.length > 0 ? raw.lastVaultPath : null;

  const recentVaults = stringArray(raw.recentVaults).slice(0, RECENT_LIMIT);

  const expanded: Record<string, string[]> = {};
  if (isRecord(raw.expanded)) {
    for (const [key, value] of Object.entries(raw.expanded)) {
      if (Array.isArray(value)) expanded[key] = stringArray(value);
    }
  }

  return { version: 1, lastVaultPath, recentVaults, expanded };
}
