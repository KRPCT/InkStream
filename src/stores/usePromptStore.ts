import { create } from 'zustand';

/**
 * 文本输入对话框的 Promise 化状态层（镜像 useConfirmStore；拒引未审计 tauri-plugin-dialog，自绘 PromptDialog 消费）。
 * 用于分支名 / tag 名 / 提交信息等输入。非 React 模块（gitActions）经 promptInput() await。
 */
export interface PromptRequest {
  title: string;
  /** 输入框上方说明（可选）。 */
  label?: string;
  placeholder?: string;
  initialValue: string;
  confirmLabel: string;
  /** true=多行 textarea（提交信息），false=单行 input（分支/tag 名）。 */
  multiline: boolean;
  /** 兑现器：输入值（已 trim 非空）/ null（取消）。消费一次即清。 */
  resolve: (value: string | null) => void;
}

interface PromptState {
  request: PromptRequest | null;
  __set: (req: PromptRequest | null) => void;
}

export const usePromptStore = create<PromptState>((set) => ({
  request: null,
  __set: (request) => set({ request }),
}));

/** 弹文本输入并 await：返回输入值（trim 后）或 null（取消）。同一时刻只一个请求。 */
export function promptInput(opts: {
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  multiline?: boolean;
}): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    usePromptStore.getState().__set({
      title: opts.title,
      label: opts.label,
      placeholder: opts.placeholder,
      initialValue: opts.initialValue ?? '',
      confirmLabel: opts.confirmLabel ?? '确认',
      multiline: opts.multiline ?? false,
      resolve: (value) => {
        usePromptStore.getState().__set(null);
        resolve(value);
      },
    });
  });
}
