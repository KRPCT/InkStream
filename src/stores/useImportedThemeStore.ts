import { create } from 'zustand';
import { loadCustomTheme, saveCustomTheme } from '../ipc/importedTheme';
import { inspectImportedTheme, themeStylesheet } from '../styles/themeImport';
import type { ImportedTheme, ThemePreview } from '../types/importedTheme';
import { showToast } from './useToastStore';

export const useImportedThemeStore = create<{ current: ThemePreview | null; busy: boolean }>(() => ({ current: null, busy: false }));
let generation = 0;
let tail: Promise<void> = Promise.resolve();
function publish(preview: ThemePreview | null): void {
  const previous = document.getElementById('inkstream-imported-theme');
  if (preview) {
    const element = previous ?? document.createElement('style');
    element.id = 'inkstream-imported-theme';
    element.textContent = themeStylesheet(preview);
    if (!previous) document.head.append(element);
  } else previous?.remove();
  useImportedThemeStore.setState({ current: preview });
}

export function applyCustomTheme(preview: ThemePreview | null): Promise<void> {
  ++generation;
  const operation = tail.then(async () => {
    useImportedThemeStore.setState({ busy: true });
    try { await saveCustomTheme(preview?.source ?? null); publish(preview); }
    finally { useImportedThemeStore.setState({ busy: false }); }
  });
  tail = operation.catch(() => {});
  return operation;
}

/** Revalidate the app-local source on every launch; late hydration cannot replace a user action. */
export async function initImportedTheme(): Promise<void> {
  const request = ++generation;
  try {
    const raw = await loadCustomTheme();
    if (request !== generation) return;
    if (raw === null || raw === undefined) { publish(null); return; }
    if (typeof raw !== 'object' || !('name' in raw) || !('css' in raw) || !('version' in raw) ||
      raw.version !== 1 || typeof raw.name !== 'string' || typeof raw.css !== 'string') throw new Error('主题记录格式不正确');
    publish(inspectImportedTheme(raw as ImportedTheme));
  } catch (error) {
    if (request === generation) showToast('warning', `导入主题未能恢复，已保留当前外观：${String(error)}`);
  }
}
