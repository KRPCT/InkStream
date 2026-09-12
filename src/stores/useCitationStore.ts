import { create } from 'zustand';

/**
 * 活动文档引用镜像（Phase 8 ZOT-03，RightPanel 引用 tab）。
 *
 * 单向纪律（仿 useOutlineStore）：CM doc → store（editor/citations.ts 的 syncCitations 在换装 + docChanged 写入），
 * store 永不回写 CM。citations 由三种文档语言的共享模型去重计数；validKeys 属于当前文献库。
 * CitationPanel 使用在线条目或当前账户离线缓存，读取失败/账户变化时先清除已解析判定。
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
  resetResolution: () => void;
}

export const useCitationStore = create<CitationState>((set) => ({
  citations: [],
  validKeys: [],
  resolved: false,
  setCitations: (citations) => set({ citations }),
  setValidKeys: (validKeys) => set({ validKeys, resolved: true }),
  resetResolution: () => set({ validKeys: [], resolved: false }),
}));
