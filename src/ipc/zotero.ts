import type { CslItem, ZoteroItem } from '../types/zotero';
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

/** 取 Zotero 库内全部 citekey（ZOT-03 解析 Citation Panel 的未解析判定）。失败 throw 友好错误。 */
export function zoteroCitekeys(): Promise<string[]> {
  return invoke('zotero_citekeys', undefined);
}

/** 取 Zotero 库条目（ACAD-01 Sidebar 文献库：citekey + 标题 + 作者 + 年）。失败 throw 友好错误。 */
export function zoteroItems(): Promise<ZoteroItem[]> {
  return invoke('zotero_items', undefined);
}

/** 取指定 citekey 的完整 CSL-JSON 条目（ZOT-04 参考文献展开）。按入参顺序返回，缺失键跳过。 */
export function zoteroCsl(keys: string[]): Promise<CslItem[]> {
  return invoke('zotero_csl', { keys });
}
