import { create } from 'zustand';

/**
 * Focus Mode 开关（CREA-03，全局：一个开关作用于所有文档）。focusModePlugin 读取本 store 决定是否淡化
 * 非光标段落；toggleFocusMode 翻转后派发 refreshLivePreview 让活动视图重建装饰。
 */
interface FocusModeState {
  active: boolean;
  toggle: () => void;
  setActive: (active: boolean) => void;
}

export const useFocusModeStore = create<FocusModeState>((set) => ({
  active: false,
  toggle: () => set((s) => ({ active: !s.active })),
  setActive: (active) => set({ active }),
}));
