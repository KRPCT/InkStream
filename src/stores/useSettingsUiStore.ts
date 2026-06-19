import { create } from 'zustand';

/** 设置模态的分类（簇②，Obsidian 风左侧分类；'account' 簇④；'zotero' Phase 8 ZOT-02）。 */
export type SettingsCategory = 'general' | 'appearance' | 'editor' | 'git' | 'account' | 'zotero';

interface SettingsUiState {
  open: boolean;
  category: SettingsCategory;
  openSettings: (category?: SettingsCategory) => void;
  closeSettings: () => void;
  setCategory: (category: SettingsCategory) => void;
}

/** 设置模态开关 + 当前分类（纯 UI 态；具体设置值在 useSettingsStore）。 */
export const useSettingsUiStore = create<SettingsUiState>((set) => ({
  open: false,
  category: 'general',
  openSettings: (category) => set(category ? { open: true, category } : { open: true }),
  closeSettings: () => set({ open: false }),
  setCategory: (category) => set({ category }),
}));
