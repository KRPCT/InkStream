import { create } from 'zustand';
import type { ChapterNode } from '../types/creative';
import type { VaultInfo } from '../types/vault';

/**
 * 章节-场景树镜像（CREA-01）。单向：ChapterSceneTree 据 vault 变更重建写入；活动场景字数由组件叠加
 * useWordCountStore（不在此持久态）。同 useOutlineStore 纪律——隔离的只读导航镜像。
 */
interface ChapterTreeState {
  chapters: ChapterNode[];
  loading: boolean;
  scope: VaultInfo | null;
  error: string | null;
  setChapters: (chapters: ChapterNode[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useChapterTreeStore = create<ChapterTreeState>((set) => ({
  chapters: [],
  loading: false,
  scope: null,
  error: null,
  setChapters: (chapters) => set({ chapters, loading: false }),
  setLoading: (loading) => set({ loading }),
}));
