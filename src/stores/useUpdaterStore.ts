import { create } from 'zustand';
import { checkForUpdate, installPending, relaunchApp } from '../ipc/updater';
import { showToast } from './useToastStore';

/**
 * 自动更新状态（FEAT-UPDATER）。会话内内存态：检查 / 可用 / 下载进度 / 就绪 / 出错 + 对话框开关。
 * 两个入口纪律不同：checkSilent（启动）无更新 / dev / 出错一律静默；checkManual（命令 / 关于页）给 toast 反馈。
 * 并发 / StrictMode 双触发由模块级 checking 守卫（同 osFileOpen 代际令牌取向）。
 */
type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  progress: number;
  dialogOpen: boolean;
  checkSilent: () => Promise<void>;
  checkManual: () => Promise<void>;
  install: () => Promise<void>;
  relaunch: () => void;
  closeDialog: () => void;
}

let checking = false;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: 'idle',
  version: null,
  progress: 0,
  dialogOpen: false,

  checkSilent: async () => {
    if (checking || get().status === 'downloading') return;
    checking = true;
    const info = await checkForUpdate();
    checking = false;
    // none / error / dev 一律静默；仅有更新才弹。
    if (info.status === 'update') set({ status: 'available', version: info.version ?? null, dialogOpen: true });
  },

  checkManual: async () => {
    if (checking || get().status === 'downloading') return;
    checking = true;
    set({ status: 'checking' });
    const info = await checkForUpdate();
    checking = false;
    if (info.status === 'update') {
      set({ status: 'available', version: info.version ?? null, dialogOpen: true });
    } else if (info.status === 'error') {
      set({ status: 'idle' });
      showToast('error', '检查更新失败，请检查网络后重试。');
    } else {
      set({ status: 'idle' });
      showToast('warning', '已是最新版本。');
    }
  },

  install: async () => {
    if (checking || get().status === 'downloading') return;
    set({ status: 'downloading', progress: 0 });
    try {
      await installPending((downloaded, total) => {
        set({ progress: total ? Math.min(1, downloaded / total) : 0 });
      });
      set({ status: 'ready', progress: 1 });
    } catch {
      // 留 dialogOpen=true，让对话框切到错误态供「重试」。
      set({ status: 'error' });
      showToast('error', '更新下载失败，请稍后重试。');
    }
  },

  relaunch: () => void relaunchApp(),
  // 下载中不可关；关闭即复位 transient 态（防陈旧 status/progress 污染下次检查与重开）。
  closeDialog: () => {
    if (get().status === 'downloading') return;
    set({ dialogOpen: false, status: 'idle', progress: 0 });
  },
}));
