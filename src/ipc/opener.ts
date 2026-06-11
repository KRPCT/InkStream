import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * 允许经 OS 打开的外链 scheme 白名单。
 * 仅 http(s)：webview 拦截外部导航，外链须经 opener 通道交给系统浏览器；
 * javascript:/data:/file: 等一律拒绝（防 `[text](javascript:alert(1))` /
 * `data:` 脚本注入与 `file://` 越权读，RESEARCH Security V12 / 威胁 T-03-04）。
 */
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * 打开外部链接：scheme 校验通过后经 tauri-plugin-opener 交由 OS 默认浏览器打开。
 *
 * 非法 scheme（含 `javascript:` / `data:` / `file:`）或无法解析的 URL
 * 一律静默 return：不打开、不向 UI 抛错（点击非法链接是无操作而非崩溃）。
 *
 * @param url 待打开的链接；仅 `http:` / `https:` 会真正触达底层 open。
 */
export async function openExternal(url: string): Promise<void> {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    // 非法 URL（无 scheme / 畸形）——视同不可打开，直接吞掉。
    return;
  }

  if (!ALLOWED_SCHEMES.has(protocol)) {
    return;
  }

  await openUrl(url);
}
