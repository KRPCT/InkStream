import { create } from 'zustand';

/**
 * 打字机模式开关（写作模式升级，全局：一个开关作用于所有文档，与 Focus Mode 同范式）。
 * typewriterPlugin 读取本 store 决定是否在光标移动 / 编辑时把当前行滚到视口垂直居中；
 * toggleTypewriter 翻转后派发 refreshLivePreview 让活动视图立即居中。纯内存、不持久化（同 useFocusModeStore）。
 */
interface TypewriterState {
  active: boolean;
  toggle: () => void;
  setActive: (active: boolean) => void;
}

export const useTypewriterStore = create<TypewriterState>((set) => ({
  active: false,
  toggle: () => set((s) => ({ active: !s.active })),
  setActive: (active) => set({ active }),
}));
