import { create } from 'zustand';

interface AboutState {
  open: boolean;
  openAbout: () => void;
  closeAbout: () => void;
}

/**
 * 关于对话框显隐状态（app.about 命令的被调方）。
 * 独立小 store：builtins 经 getState() 调用，零 React 渲染依赖（Plan 04 既定纪律）。
 */
export const useAboutStore = create<AboutState>((set) => ({
  open: false,
  openAbout: () => set({ open: true }),
  closeAbout: () => set({ open: false }),
}));
