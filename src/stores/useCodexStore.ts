import { create } from 'zustand';
import type { CodexEntry } from '../types/creative';

/**
 * Codex 条目镜像（CREA-02）。单向：editor/codex.ts 扫 `Codex/` 文件夹后写入；提及高亮 ViewPlugin 与
 * 悬停卡读取本 store（Codex 为 vault 全局、跨文档同一份，故全局 store 而非 per-view facet）。
 */
interface CodexState {
  entries: CodexEntry[];
  setEntries: (entries: CodexEntry[]) => void;
}

export const useCodexStore = create<CodexState>((set) => ({
  entries: [],
  setEntries: (entries) => set({ entries }),
}));
