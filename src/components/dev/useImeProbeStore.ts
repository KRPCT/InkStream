import { create } from 'zustand';

interface ImeProbeState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

/**
 * IME 探针面板显隐状态（R2 go/no-go 实验，dev-only）。
 * 独立小 store，仿 useAboutStore：DEV 命令经 getState() 调用，零 React 渲染依赖。
 * 探针整体可整目录删除（R2 实验结束即拆），故 store 与命令、面板同居 dev/ 目录。
 */
export const useImeProbeStore = create<ImeProbeState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));

// DEV 诊断通道：CDP/控制台可 __imeProbeStore.getState().toggle() 直开面板（生产构建摇树移除）。
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __imeProbeStore?: typeof useImeProbeStore }).__imeProbeStore =
    useImeProbeStore;
}
