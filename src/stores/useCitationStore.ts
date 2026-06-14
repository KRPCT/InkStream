import { create } from 'zustand';

/**
 * 活动文档引用镜像（Phase 8 ZOT-03，RightPanel 引用 tab）。
 *
 * 单向纪律（仿 useOutlineStore）：CM doc → store（editor/citations.ts 的 syncCitations 在换装 + docChanged 写入），
 * store 永不回写 CM。citations = 文档内 `[@key]` 去重 + 计数（按首现顺序）；validKeys = Zotero 库已知 citekey
 * （CitationPanel 经 zotero_citekeys 解析填充），未在其中的 `[@key]` 即「未解析」标红。
 */

export interface CitationEntry {
  key: string;
  /** 文档内出现次数。 */
  count: number;
}

interface CitationState {
  citations: CitationEntry[];
  /** Zotero 库已知 citekey（解析后填充）；resolved=false 时不判红（避免未解析即误标）。 */
  validKeys: string[];
  resolved: boolean;
  setCitations: (citations: CitationEntry[]) => void;
  setValidKeys: (validKeys: string[]) => void;
}

export const useCitationStore = create<CitationState>((set) => ({
  citations: [],
  validKeys: [],
  resolved: false,
  setCitations: (citations) => set({ citations }),
  setValidKeys: (validKeys) => set({ validKeys, resolved: true }),
}));
