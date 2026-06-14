import { invoke } from './invoke';

/**
 * Zotero IPC（Phase 8 ZOT）。CAYW 等本地端点经 Rust reqwest 代理（绕 webview CORS）。
 */

/**
 * 触发 Zotero Better BibTeX CAYW picker（交互式，阻塞到用户选完）。
 * 返回 pandoc 格式引用串（`[@citekey]` / 多选 `[@a; @b]`）；用户取消返回空串。
 * 失败 throw 友好错误（Zotero 未运行 / BBT 未装 / 超时）。
 */
export function zoteroCayw(): Promise<string> {
  return invoke('zotero_cayw', undefined);
}
