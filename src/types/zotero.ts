/**
 * Zotero 相关类型（Phase 8 ZOT/ACAD）。与 Rust zotero.rs 的 serde camelCase 对齐。
 */

/** 文献库条目精简视图（ACAD-01 Sidebar 文献库）。 */
export interface ZoteroItem {
  citekey: string;
  title: string;
  /** 首作者姓（多作者加「等」）。 */
  authors: string;
  year: string;
}

/** 参考文献排版样式（ZOT-04）。占位标记 `<!-- biblio:STYLE -->` 内编码。 */
export type CitationStyle = 'gbt7714' | 'apa' | 'vancouver';

/** Zotero Web API 凭据状态（ZOT-02）。API Key 本身绝不回传，仅暴露是否已配置 + userID。 */
export interface ZoteroCredStatus {
  hasKey: boolean;
  userId: string;
}

/** 一次增量同步结果（ZOT-02）：本次写入条目数 / 删除数 / 同步后 library version。 */
export interface ZoteroSyncResult {
  synced: number;
  removed: number;
  version: number;
}

/** CSL-JSON 人名（作者/编者）。机构名走 literal。 */
export interface CslName {
  family?: string;
  given?: string;
  literal?: string;
}

/**
 * CSL-JSON 条目（ZOT-04 参考文献展开消费）。Zotero Better BibTeX `item.search` 原样返回，
 * 字段按 CSL 规范命名（含连字符键）；本应用按样式渲染时只读其中常用子集，全部可选。
 */
export interface CslItem {
  type?: string;
  title?: string;
  'citation-key'?: string;
  citekey?: string;
  'container-title'?: string;
  publisher?: string;
  'publisher-place'?: string;
  edition?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  URL?: string;
  author?: CslName[];
  editor?: CslName[];
  issued?: { 'date-parts'?: (string | number)[][] };
}
