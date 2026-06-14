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
