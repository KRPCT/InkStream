import { loadBookshelf, saveBookshelf } from '../ipc/settings';
import type { PersistedBookshelf } from '../types/bookshelf';
import { useBookshelfStore } from './useBookshelfStore';
import { useToastStore } from './useToastStore';
import { validateBookshelf } from './validateBookshelf';

/**
 * 书架持久化管线（镜像 persistSettings）：hydrate(loadBookshelf→validate) → 订阅变更 500ms 防抖写盘。
 * 仅当 bookshelfEnabled 时启动（App 启动 / 设置里开启时）。关闭功能不调 reset、不清盘——数据保留（req 6）。
 */
const DEBOUNCE_MS = 500;
const SAVE_ERROR_MESSAGE = '书架保存失败，本次更改在重启后可能丢失。';

let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

function snapshot(): PersistedBookshelf {
  const { books, progress } = useBookshelfStore.getState();
  return validateBookshelf({ version: 1, books, progress });
}

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveBookshelf(snapshot()).catch(() => {
      useToastStore.getState().showToast('warning', SAVE_ERROR_MESSAGE);
    });
  }, DEBOUNCE_MS);
}

async function doInit(): Promise<void> {
  let data: PersistedBookshelf;
  try {
    data = validateBookshelf(await loadBookshelf());
  } catch {
    data = validateBookshelf(null);
  }
  useBookshelfStore.getState().hydrate(data.books, data.progress);
  // 订阅在 hydrate 之后建立：hydrate 本身不触发写盘。
  unsubscribe = useBookshelfStore.subscribe(scheduleSave);
}

/** 启动书架持久化（幂等）。仅 bookshelfEnabled 时调用。 */
export function initBookshelf(): Promise<void> {
  initPromise ??= doInit();
  return initPromise;
}

/** 复位（测试用）。 */
export function resetBookshelf(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  initPromise = null;
}
