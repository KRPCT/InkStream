import { create } from 'zustand';
import type { SceneStatus } from '../types/creative';

/**
 * 活动场景概要镜像（CREA-05）。单向：editor/sceneSummary 在换装入口 + docChanged 时从 frontmatter
 * summary 写入；RightPanel 场景概要 tab 与编辑器顶卡片读取（同 useOutlineStore 纪律）。
 */
interface SceneSummaryState {
  summary: string;
  status: SceneStatus | null;
  sourcePath: string | null;
  setSummary: (summary: string) => void;
}

export const useSceneSummaryStore = create<SceneSummaryState>((set) => ({
  summary: '',
  status: null,
  sourcePath: null,
  setSummary: (summary) => set({ summary }),
}));
