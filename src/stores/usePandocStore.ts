import { create } from 'zustand';
import { pandocAvailable } from '../ipc/pandoc';

/**
 * 系统 pandoc 探测结果（FEAT-EXPORT）：启动时 detect() 探测一次，available 门控 pandoc 格式导出入口
 * 在「导出为」菜单 / 命令面板的显隐（系统未装 pandoc 时不显示这些格式）。
 */
interface PandocState {
  available: boolean;
  checked: boolean;
  detect: () => Promise<void>;
}

export const usePandocStore = create<PandocState>((set, get) => ({
  available: false,
  checked: false,
  detect: async () => {
    if (get().checked) return;
    const available = await pandocAvailable().catch(() => false);
    set({ available, checked: true });
  },
}));
