import { getCurrentWindow, type CloseRequestedEvent, type DragDropEvent } from '@tauri-apps/api/window';
import type { UnlistenFn } from '@tauri-apps/api/event';

const win = getCurrentWindow();

/** 主窗口控制：自绘 TitleBar 按钮与启动流程的唯一窗口操作入口。 */
export const windowControls = {
  minimize: () => win.minimize(),
  toggleMaximize: () => win.toggleMaximize(),
  close: () => win.close(),
  /** 强制关闭（绕过 onCloseRequested 守卫）：退出确认通过后调用。 */
  destroy: () => win.destroy(),
  show: () => win.show(),
  /** 关闭请求拦截（未提交退出提醒）：handler 内同步 preventDefault 后异步确认，确认则 destroy。 */
  onCloseRequested: (cb: (event: CloseRequestedEvent) => void | Promise<void>) =>
    win.onCloseRequested(cb),
  /** 跟随系统主题（D-13）：订阅系统亮暗变化，返回取消订阅函数的 Promise。 */
  onThemeChanged: (cb: (theme: 'light' | 'dark') => void) =>
    win.onThemeChanged(({ payload }) => cb(payload)),
  /** OS 文件拖拽（#6）：拖文件到窗口，type:'drop' 携带绝对路径数组。返回取消订阅函数的 Promise。 */
  onDragDrop: (cb: (event: DragDropEvent) => void): Promise<UnlistenFn> =>
    win.onDragDropEvent((e) => cb(e.payload)),
};
