import { getCurrentWindow } from '@tauri-apps/api/window';

const win = getCurrentWindow();

/** 主窗口控制：自绘 TitleBar 按钮与启动流程的唯一窗口操作入口。 */
export const windowControls = {
  minimize: () => win.minimize(),
  toggleMaximize: () => win.toggleMaximize(),
  close: () => win.close(),
  show: () => win.show(),
  /** 跟随系统主题（D-13）：订阅系统亮暗变化，返回取消订阅函数的 Promise。 */
  onThemeChanged: (cb: (theme: 'light' | 'dark') => void) =>
    win.onThemeChanged(({ payload }) => cb(payload)),
};
