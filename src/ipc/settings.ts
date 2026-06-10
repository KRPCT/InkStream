import { load, type Store } from '@tauri-apps/plugin-store';
import type { PersistedSettings } from '../types/settings';

/**
 * settings.json 读写收口（tauri-plugin-store，应用配置目录）。
 * 全项目唯一接触 '@tauri-apps/plugin-store' 的文件（ipc/ 收口立约）。
 * autoSave 关闭：落盘节奏由 persistSettings 的 500ms 防抖统一控制。
 */

const FILE = 'settings.json';

let storePromise: Promise<Store> | null = null;

function settingsStore(): Promise<Store> {
  storePromise ??= load(FILE, { defaults: {}, autoSave: false });
  return storePromise;
}

/** 读全部键值为单一对象（形状校验交给 validateSettings，此处只搬运）。 */
export async function loadSettings(): Promise<unknown> {
  const store = await settingsStore();
  return Object.fromEntries(await store.entries());
}

/** 整体写入五个顶层键并显式 save()。 */
export async function saveSettings(s: PersistedSettings): Promise<void> {
  const store = await settingsStore();
  await store.set('version', s.version);
  await store.set('theme', s.theme);
  await store.set('mode', s.mode);
  await store.set('layouts', s.layouts);
  await store.set('commandMru', s.commandMru);
  await store.save();
}
