import type { ResolvedTheme } from '../types/settings';
import { windowControls } from './window';

export type Unsubscribe = () => void;

function fallbackMatchMedia(cb: (theme: ResolvedTheme) => void): Unsubscribe {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = (e: MediaQueryListEvent) => cb(e.matches ? 'dark' : 'light');
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}

/**
 * 订阅系统主题变化（D-13 跟随系统）。
 * 主路走 Tauri onThemeChanged 事件；订阅失败（非 Tauri 环境 / 平台不支持，A3）
 * 回退 matchMedia('prefers-color-scheme') change 监听，行为等价。
 */
export function subscribeSystemTheme(cb: (theme: ResolvedTheme) => void): Unsubscribe {
  let disposed = false;
  let unlisten: Unsubscribe | null = null;

  const activateFallback = () => {
    if (disposed) return;
    unlisten = fallbackMatchMedia(cb);
  };

  try {
    windowControls.onThemeChanged(cb).then((un) => {
      if (disposed) un();
      else unlisten = un;
    }, activateFallback);
  } catch {
    activateFallback();
  }

  return () => {
    disposed = true;
    unlisten?.();
  };
}
