import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Tauri asset 协议通道（ipc/ 收口立约：全项目唯一接触 @tauri-apps/api 的目录）。
 *
 * 把一个**已在 vault 内**的绝对路径转为 webview 可加载的 `asset://localhost/<path>` URL
 * （CSP img-src 已放行 asset:，Plan 02）。webview 拦 file://，asset 协议是本地图加载的唯一路。
 *
 * 安全（T-03-19 / Q3 安全边界下移）：assetProtocol scope 为 broad `[**]`，故「仅 vault 内路径」
 * 的判定**不在此处**——调用方（ImageWidget.resolveVaultImage）须先断言路径在 vault 根内再调用本函数，
 * 绝不把任意绝对路径传入（承 Phase 2 path_guard 纪律）。本函数只做协议转换，不做边界校验。
 */
export function assetUrl(absPath: string): string {
  return convertFileSrc(absPath);
}
