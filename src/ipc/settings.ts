import { load, type Store } from '@tauri-apps/plugin-store';
import type { PersistedBookshelf } from '../types/bookshelf';
import type { PersistedSettings } from '../types/settings';
import type { PersistedVault } from '../types/vault';

/**
 * settings.json / vault-state.json 读写收口（tauri-plugin-store，应用配置目录）。
 * 全项目唯一接触 '@tauri-apps/plugin-store' 的文件（ipc/ 收口立约）。
 * autoSave 关闭：落盘节奏由 persistSettings / persistVault 的 500ms 防抖统一控制。
 *
 * D-08 零写入语义：vault 级状态存应用数据目录（与 settings.json 同体系），
 * 绝不写入用户 vault 目录（不创建 .inkstream/），git status 永远干净。
 */

const FILE = 'settings.json';
const VAULT_FILE = 'vault-state.json';
const BOOKSHELF_FILE = 'bookshelf.json';

let storePromise: Promise<Store> | null = null;
let vaultStorePromise: Promise<Store> | null = null;
let bookshelfStorePromise: Promise<Store> | null = null;

function settingsStore(): Promise<Store> {
  storePromise ??= load(FILE, { defaults: {}, autoSave: false });
  return storePromise;
}

function vaultStateStore(): Promise<Store> {
  vaultStorePromise ??= load(VAULT_FILE, { defaults: {}, autoSave: false });
  return vaultStorePromise;
}

/** 读全部键值为单一对象（形状校验交给 validateSettings，此处只搬运）。 */
export async function loadSettings(): Promise<unknown> {
  const store = await settingsStore();
  return Object.fromEntries(await store.entries());
}

/** 整体写入全部顶层键并显式 save()（含簇② 与 simpleMode——此前漏写致重启丢失，已修）。 */
export async function saveSettings(s: PersistedSettings): Promise<void> {
  const store = await settingsStore();
  await store.set('version', s.version);
  await store.set('theme', s.theme);
  await store.set('mode', s.mode);
  await store.set('layouts', s.layouts);
  await store.set('commandMru', s.commandMru);
  await store.set('autosaveEnabled', s.autosaveEnabled);
  await store.set('autosaveDelayMs', s.autosaveDelayMs);
  await store.set('editorFontSize', s.editorFontSize);
  await store.set('dailyWordGoal', s.dailyWordGoal);
  await store.set('gitRemoteMode', s.gitRemoteMode);
  await store.set('gitCustomServer', s.gitCustomServer);
  await store.set('simpleMode', s.simpleMode);
  await store.set('exportBrandingFooter', s.exportBrandingFooter);
  await store.set('exportBrandingText', s.exportBrandingText);
  await store.set('bookshelfEnabled', s.bookshelfEnabled);
  await store.save();
}

/** 读 vault 级持久态（应用数据目录，D-08）；形状校验交给 validateVault。 */
export async function loadVaultState(): Promise<unknown> {
  const store = await vaultStateStore();
  return Object.fromEntries(await store.entries());
}

/** 整体写入 vault 级持久态顶层键并显式 save()（用户仓库零写入，D-08）。 */
export async function saveVaultState(v: PersistedVault): Promise<void> {
  const store = await vaultStateStore();
  await store.set('version', v.version);
  await store.set('lastVaultPath', v.lastVaultPath);
  await store.set('recentVaults', v.recentVaults);
  await store.set('expanded', v.expanded);
  await store.save();
}

function bookshelfStore(): Promise<Store> {
  bookshelfStorePromise ??= load(BOOKSHELF_FILE, { defaults: {}, autoSave: false });
  return bookshelfStorePromise;
}

/** 读书架索引（应用数据目录，索引 only，绝不动源文件）；形状校验交给 validateBookshelf。 */
export async function loadBookshelf(): Promise<unknown> {
  const store = await bookshelfStore();
  return Object.fromEntries(await store.entries());
}

/** 整体写入书架索引顶层键并显式 save()。关闭书架功能不走此（无删除路径，数据保留）。 */
export async function saveBookshelf(b: PersistedBookshelf): Promise<void> {
  const store = await bookshelfStore();
  await store.set('version', b.version);
  await store.set('books', b.books);
  await store.set('progress', b.progress);
  await store.save();
}
