import { create } from 'zustand';

/**
 * 字数镜像（CREA-04）：单向自 editor/wordCount 写入，store 永不回写 CM（同 useOutlineStore 纪律）。
 * - activeCount：活动文档当前正文字数（剔除 frontmatter）。
 * - todayWritten：今日净写入字数（换日重置、仅记编辑增量，切 tab 不计），驱动 StatusBar 进度条。
 */
interface WordCountState {
  activeCount: number;
  todayWritten: number;
  report: (activeCount: number, todayWritten: number) => void;
}

export const useWordCountStore = create<WordCountState>((set) => ({
  activeCount: 0,
  todayWritten: 0,
  report: (activeCount, todayWritten) => set({ activeCount, todayWritten }),
}));
