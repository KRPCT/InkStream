import { load, type Store } from '@tauri-apps/plugin-store';
import type { ImportedTheme } from '../types/importedTheme';

let pending: Promise<Store> | undefined;
function store(): Promise<Store> { return pending ??= load('imported-theme.json', { defaults: {}, autoSave: false }); }
export async function loadCustomTheme(): Promise<unknown> { return (await store()).get('theme'); }
export async function saveCustomTheme(value: ImportedTheme | null): Promise<void> {
  const state = await store();
  const before = await state.get('theme');
  await state.set('theme', value);
  try { await state.save(); }
  catch (error) { await state.set('theme', before ?? null); throw error; }
}
