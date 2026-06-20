import { create } from 'zustand';
import type { BookChapter } from '../types/bookshelf';
import type { ReadingDoc, ReadingGenre, ReadingPrefs, ReadingTheme } from '../types/reading';

/**
 * 从书架打开时的章节上下文（FEAT-SHELF）：当前书的扁平章节列表 + 当前章索引，
 * 驱动阅读工具栏的「第 X/Y 章」与上下章导航；直接打开单文件（非书架）则为 null。
 */
export interface BookContext {
  bookId: string;
  /** 书的稳定键（rootPath）：进度按此键存。 */
  rootPath: string;
  chapters: BookChapter[];
  index: number;
}

/**
 * 阅读模式状态（FEAT-READ，会话内内存态，不持久化）：当前文档元数据 + 生效文体 + 阅读偏好 + 书架章节上下文。
 * 解析后的正文（HTML / pdf 文档对象）不进 store（不可序列化纪律），由渲染组件自管 / 模块级缓存。
 */
interface ReadingState {
  doc: ReadingDoc | null;
  /** 当前生效文体（自动识别后写入；用户可经工具栏覆盖）。 */
  genre: ReadingGenre;
  prefs: ReadingPrefs;
  /** 书架章节上下文（从书架打开时设置；直接打开文件为 null）。 */
  bookContext: BookContext | null;
  setDoc: (doc: ReadingDoc | null) => void;
  setGenre: (genre: ReadingGenre) => void;
  setTheme: (theme: ReadingTheme) => void;
  /** 字号增量（px），夹到 14–28。 */
  bumpFontSize: (delta: number) => void;
  setBookContext: (ctx: BookContext | null) => void;
}

export const useReadingStore = create<ReadingState>((set) => ({
  doc: null,
  genre: 'literature',
  prefs: { fontSize: 19, theme: 'light' },
  bookContext: null,
  setDoc: (doc) => set({ doc }),
  setGenre: (genre) => set({ genre }),
  setBookContext: (bookContext) => set({ bookContext }),
  setTheme: (theme) => set((s) => ({ prefs: { ...s.prefs, theme } })),
  bumpFontSize: (delta) =>
    set((s) => ({
      prefs: { ...s.prefs, fontSize: Math.max(14, Math.min(28, s.prefs.fontSize + delta)) },
    })),
}));
