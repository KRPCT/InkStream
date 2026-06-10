import { create } from 'zustand';

export type ToastKind = 'error' | 'warning';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: ToastItem[];
  showToast: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

/** UI-SPEC：toast 6 秒自动消失（可被点击关闭提前清理定时器）。 */
const AUTO_DISMISS_MS = 6000;

let nextId = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Toast 通知状态层（错误/警告两变体，UI-SPEC 组件状态契约）。
 * 模块级 store：persistSettings 等非 React 模块经 showToast() 直接调用，
 * 零 React 上下文依赖（Plan 04「命令副作用经 getState()」同纪律）。
 */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  showToast: (kind, message) => {
    const id = ++nextId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    timers.set(
      id,
      setTimeout(() => useToastStore.getState().dismiss(id), AUTO_DISMISS_MS),
    );
  },
  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** 任意模块可调的便捷入口（无需组件渲染即可入队）。 */
export function showToast(kind: ToastKind, message: string): void {
  useToastStore.getState().showToast(kind, message);
}
