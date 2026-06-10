/**
 * 平台检测收口（平台知识维持在 ipc/ 层单点）。
 * 主路：Tauri CLI 构建期注入 TAURI_ENV_PLATFORM（vite.config.ts envPrefix 已放行）；
 * 非 Tauri 环境（vitest / 纯 vite dev）回退 UA 判断。
 */
export function isMacOS(): boolean {
  const platform: unknown = import.meta.env.TAURI_ENV_PLATFORM;
  if (typeof platform === 'string' && platform.length > 0) {
    return platform === 'darwin';
  }
  return navigator.userAgent.includes('Mac');
}
