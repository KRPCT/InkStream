import type {
  CslItem,
  ZoteroCredStatus,
  ZoteroItem,
  ZoteroSyncResult,
} from '../types/zotero';
import { invoke } from './invoke';

let libraryRevision = 0;
const libraryListeners = new Set<() => void>();

/** 凭据或完整缓存提交后，使界面重新获取当前文献库。 */
export function onZoteroLibraryChanged(listener: () => void): () => void {
  libraryListeners.add(listener);
  return () => { libraryListeners.delete(listener); };
}

function libraryChanged(): void {
  libraryRevision += 1;
  for (const listener of libraryListeners) listener();
}

function requireCurrentLibrary(revision: number): void {
  if (revision !== libraryRevision) {
    throw new Error('Zotero 文献库已变更，请重新读取当前账户。');
  }
}

/** 读取或同步不能把旧账户的迟到结果交给当前账户的界面。 */
async function forCurrentLibrary<T>(load: () => Promise<T>): Promise<T> {
  const revision = libraryRevision;
  try {
    const result = await load();
    requireCurrentLibrary(revision);
    return result;
  } catch (error) {
    requireCurrentLibrary(revision);
    throw error;
  }
}

/**
 * Zotero IPC（Phase 8 ZOT）。CAYW 等本地端点经 Rust reqwest 代理（绕 webview CORS）。
 */

/**
 * 触发 Zotero Better BibTeX CAYW picker（交互式，阻塞到用户选完）。
 * 返回 pandoc 格式引用串（`[@citekey]` / 多选 `[@a; @b]`）；用户取消返回空串。
 * 失败 throw 友好错误（Zotero 未运行 / BBT 未装 / 超时）。
 */
export function zoteroCayw(): Promise<string> {
  return invoke('zotero_cayw', undefined);
}

/** 取 Zotero 库内全部 citekey（ZOT-03 解析 Citation Panel 的未解析判定）。失败 throw 友好错误。 */
export function zoteroCitekeys(): Promise<string[]> {
  return invoke('zotero_citekeys', undefined);
}

/** 取 Zotero 库条目（ACAD-01 Sidebar 文献库：citekey + 标题 + 作者 + 年）。失败 throw 友好错误。 */
export function zoteroItems(): Promise<ZoteroItem[]> {
  return invoke('zotero_items', undefined);
}

/** 取指定 citekey 的完整 CSL-JSON 条目（ZOT-04 参考文献展开）。按入参顺序返回，缺失键跳过。 */
export function zoteroCsl(keys: string[]): Promise<CslItem[]> {
  return invoke('zotero_csl', { keys });
}

// ── ZOT-02 Web API 同步 + 离线缓存 ──

/** 保存 Zotero Web API 凭据（API Key + userID，落 keyring）。 */
export async function zoteroSetCredentials(apiKey: string, userId: string): Promise<null> {
  const result = await invoke('zotero_set_credentials', { apiKey, userId });
  libraryChanged();
  return result;
}

/** 清除已存的 Zotero 凭据。 */
export async function zoteroClearCredentials(): Promise<null> {
  const result = await invoke('zotero_clear_credentials', undefined);
  libraryChanged();
  return result;
}

/** 凭据状态（是否已配置 + userID）。API Key 绝不回传。 */
export function zoteroCredentialsStatus(): Promise<ZoteroCredStatus> {
  return invoke('zotero_credentials_status', undefined);
}

/** 触发一次 Web API 增量同步（落地 SQLite 缓存）。失败 throw 友好错误。 */
export async function zoteroSync(): Promise<ZoteroSyncResult> {
  const result = await forCurrentLibrary(() => invoke('zotero_sync', undefined));
  libraryChanged();
  return result;
}

/** 离线读缓存：Sidebar 文献库条目。 */
export function zoteroCacheItems(): Promise<ZoteroItem[]> {
  return forCurrentLibrary(() => invoke('zotero_cache_items', undefined));
}

/** 离线读缓存：指定 citekey 的完整 CSL-JSON。 */
export function zoteroCacheCsl(keys: string[]): Promise<CslItem[]> {
  return forCurrentLibrary(() => invoke('zotero_cache_csl', { keys }));
}

/**
 * Sidebar 文献库取数（在线优先、离线回退 ZOT-02）：先连本地 BBT，失败（Zotero 未运行）
 * 则回退已同步的 SQLite 缓存；缓存也空时抛出原始 BBT 错误。offline=true 表示来自缓存。
 */
export async function zoteroItemsResilient(): Promise<{ items: ZoteroItem[]; offline: boolean }> {
  return forCurrentLibrary(async () => {
    try {
      return { items: await zoteroItems(), offline: false };
    } catch (bbtError) {
      try {
        const items = await zoteroCacheItems();
        if (items.length > 0) return { items, offline: true };
      } catch {
        /* 缓存读失败 → 落回 BBT 错误；外层还会拒绝旧账户结果。 */
      }
      throw bbtError;
    }
  });
}

/** 参考文献 CSL 取数（在线优先、离线回退 ZOT-02）：BBT 失败回退 SQLite 缓存。 */
export async function zoteroCslResilient(keys: string[]): Promise<CslItem[]> {
  return forCurrentLibrary(async () => {
    try {
      return await zoteroCsl(keys);
    } catch (bbtError) {
      try {
        const cached = await zoteroCacheCsl(keys);
        if (cached.length > 0) return cached;
      } catch {
        /* 缓存读失败 → 落回 BBT 错误；外层还会拒绝旧账户结果。 */
      }
      throw bbtError;
    }
  });
}
