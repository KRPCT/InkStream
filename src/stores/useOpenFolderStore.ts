import { create } from 'zustand';

/** 打开文件夹路径输入请求（一次一个；resolve 由 OpenFolderDialog 回填）。 */
export interface OpenFolderRequest {
  /** 兑现器：返回输入的路径，或取消时 null。消费一次即清。 */
  resolve: (path: string | null) => void;
}

interface OpenFolderState {
  /** 当前待输入请求；无则 null（不渲染对话框）。 */
  request: OpenFolderRequest | null;
  /** 内部：设置请求（openFolderDialog 用）。 */
  __set: (req: OpenFolderRequest | null) => void;
}

/**
 * 「打开文件夹」路径输入的 Promise 化状态层（拒引未审计 tauri-plugin-dialog，
 * 自绘 OpenFolderDialog 消费——延续 useConfirmStore / useAboutStore 范式）。
 *
 * 非 React 模块（vaultFlow.requestOpenFolder）经 openFolderDialog() await 用户输入，
 * 零 React 上下文依赖。同一时刻只存在一个请求。
 */
export const useOpenFolderStore = create<OpenFolderState>((set) => ({
  request: null,
  __set: (request) => set({ request }),
}));

/**
 * 弹路径输入对话框并 await 结果：返回输入的绝对路径，或取消/为空时 null。
 * resolve 后立即清空 request（对话框卸载）。
 */
export function openFolderDialog(): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    useOpenFolderStore.getState().__set({
      resolve: (path) => {
        useOpenFolderStore.getState().__set(null);
        resolve(path);
      },
    });
  });
}
