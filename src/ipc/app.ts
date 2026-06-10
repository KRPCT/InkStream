import { getVersion } from '@tauri-apps/api/app';

/**
 * 应用元信息收口（项目立约：前端只允许 src/ipc/ 接触 Tauri API）。
 * getVersion 经 capability 已授权的 core:default（含 core:app:default），零新增权限。
 */

/** 应用版本号；非 Tauri 环境（纯浏览器 dev / 测试）回退 'dev'。 */
export async function getAppVersion(): Promise<string> {
  try {
    const version = await getVersion();
    return typeof version === 'string' && version.length > 0 ? version : 'dev';
  } catch {
    return 'dev';
  }
}
