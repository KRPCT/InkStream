import { create } from 'zustand';
import type { ReadingDoc, ReadingGenre, ReadingPrefs, ReadingTheme } from '../types/reading';

/**
 * 阅读模式状态（FEAT-READ，会话内内存态，不持久化）：当前文档元数据 + 生效文体 + 阅读偏好。
 * 解析后的正文（HTML / pdf 文档对象）不进 store（不可序列化纪律），由渲染组件自管 / 模块级缓存。
 */
interface ReadingState {
  doc: ReadingDoc | null;
  /** 当前生效文体（自动识别后写入；用户可经工具栏覆盖）。 */
  genre: ReadingGenre;
  prefs: ReadingPrefs;
  setDoc: (doc: ReadingDoc | null) => void;
  setGenre: (genre: ReadingGenre) => void;
  setTheme: (theme: ReadingTheme) => void;
  /** 字号增量（px），夹到 14–28。 */
  bumpFontSize: (delta: number) => void;
}

export const useReadingStore = create<ReadingState>((set) => ({
  doc: null,
  genre: 'literature',
  prefs: { fontSize: 19, theme: 'light' },
  setDoc: (doc) => set({ doc }),
  setGenre: (genre) => set({ genre }),
  setTheme: (theme) => set((s) => ({ prefs: { ...s.prefs, theme } })),
  bumpFontSize: (delta) =>
    set((s) => ({
      prefs: { ...s.prefs, fontSize: Math.max(14, Math.min(28, s.prefs.fontSize + delta)) },
    })),
}));
