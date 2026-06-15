import { create } from 'zustand';

/** 多选项（id 唯一）；kind 决定按钮样式：primary 强调填充、danger 用 --color-error、其余普通描边。 */
export interface ChoiceOption {
  id: string;
  label: string;
  kind?: 'primary' | 'danger';
}

/** 多选确认请求（一次一个；resolve 返回选中项 id，或 null=取消/Esc/遮罩）。 */
export interface ChoiceRequest {
  title: string;
  body: string;
  options: ChoiceOption[];
  resolve: (id: string | null) => void;
}

interface ChoiceState {
  request: ChoiceRequest | null;
  __set: (req: ChoiceRequest | null) => void;
}

/**
 * 多选确认的 Promise 化状态层（≥3 路出口场景；confirmDestructive 只能二选一）。
 * 自绘 ChoiceDialog 消费，非 React 模块（vaultFlow 切库提交确认）经 chooseAction() await。
 */
export const useChoiceStore = create<ChoiceState>((set) => ({
  request: null,
  __set: (request) => set({ request }),
}));

/** 弹多选确认并 await 选中项 id；取消/Esc/遮罩 → null。同一时刻只存在一个请求。 */
export function chooseAction(opts: {
  title: string;
  body: string;
  options: ChoiceOption[];
}): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    useChoiceStore.getState().__set({
      ...opts,
      resolve: (id) => {
        useChoiceStore.getState().__set(null);
        resolve(id);
      },
    });
  });
}
