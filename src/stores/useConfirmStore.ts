import { create } from 'zustand';

/** 破坏性确认请求（一次一个；resolve 由 ConfirmDialog 按钮回填）。 */
export interface ConfirmRequest {
  /** 标题（如「删除文件」）。 */
  title: string;
  /** 正文说明（含文件名与后果，如送回收站）。 */
  body: string;
  /** 确认按钮文案（破坏性，--color-error）。 */
  confirmLabel: string;
  /** 兑现器：true=确认 / false=取消（点遮罩 / Esc / 取消按钮）。消费一次即清。 */
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  /** 当前待确认请求；无则 null（不渲染对话框）。 */
  request: ConfirmRequest | null;
  /** 内部：设置请求（confirmDestructive 用）。 */
  __set: (req: ConfirmRequest | null) => void;
}

/**
 * 破坏性确认的 Promise 化状态层（拒引未审计 tauri-plugin-dialog，自绘 ConfirmDialog 消费）。
 *
 * 非 React 模块（fileTreeOps / 外部变更仲裁）经 confirmDestructive() await 用户选择，
 * 零 React 上下文依赖（Plan 04 既定纪律，同 useToastStore/useAboutStore）。
 */
export const useConfirmStore = create<ConfirmState>((set) => ({
  request: null,
  __set: (request) => set({ request }),
}));

/**
 * 弹破坏性确认并 await 结果：确认 true / 取消 false。
 * resolve 后立即清空 request（对话框卸载）。同一时刻只存在一个请求。
 */
export function confirmDestructive(opts: {
  title: string;
  body: string;
  confirmLabel: string;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useConfirmStore.getState().__set({
      ...opts,
      resolve: (ok) => {
        useConfirmStore.getState().__set(null);
        resolve(ok);
      },
    });
  });
}
