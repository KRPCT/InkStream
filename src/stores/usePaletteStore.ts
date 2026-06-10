import { create } from 'zustand';

interface PaletteState {
  open: boolean;
  query: string;
  /** 打开并预填「>」（D-06：默认进入命令 provider）。 */
  openPalette: () => void;
  closePalette: () => void;
  toggle: () => void;
  setQuery: (query: string) => void;
}

/**
 * 命令面板显隐与输入状态（SHELL-04）。
 * 命令本体在 registry（模块级单例），此处只管弹层 UI 状态。
 */
export const usePaletteStore = create<PaletteState>((set, get) => ({
  open: false,
  query: '>',
  openPalette: () => set({ open: true, query: '>' }),
  closePalette: () => set({ open: false }),
  toggle: () => {
    if (get().open) set({ open: false });
    else set({ open: true, query: '>' });
  },
  setQuery: (query) => set({ query }),
}));
