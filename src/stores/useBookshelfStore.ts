import { create } from 'zustand';
import type { Book, ReadingProgress } from '../types/bookshelf';

/**
 * 书架状态（FEAT-SHELF）：书籍列表 + 按文档绝对路径键的阅读进度。索引 only，落盘见 persistBookshelf。
 * progress 独立于 books：未上架的文档也记进度，故「加入书架」提示可显示「续读 X%」。
 */
interface BookshelfState {
  books: Book[];
  progress: Record<string, ReadingProgress>;
  addBook: (book: Book) => void;
  removeBook: (id: string) => void;
  setProgress: (path: string, p: ReadingProgress) => void;
  touch: (id: string) => void;
  hydrate: (books: Book[], progress: Record<string, ReadingProgress>) => void;
}

export const useBookshelfStore = create<BookshelfState>((set) => ({
  books: [],
  progress: {},
  addBook: (book) => set((s) => (s.books.some((b) => b.id === book.id) ? s : { books: [...s.books, book] })),
  removeBook: (id) => set((s) => ({ books: s.books.filter((b) => b.id !== id) })),
  setProgress: (path, p) => set((s) => ({ progress: { ...s.progress, [path]: p } })),
  touch: (id) =>
    set((s) => ({ books: s.books.map((b) => (b.id === id ? { ...b, lastOpenedAt: Date.now() } : b)) })),
  hydrate: (books, progress) => set({ books, progress }),
}));

/** 某绝对路径是否已在架（单文件书 rootPath 命中，或任一书任一章 path 命中）。 */
export function isPathShelved(path: string): boolean {
  return useBookshelfStore.getState().books.some(
    (b) => b.rootPath === path || b.volumes.some((v) => v.chapters.some((c) => c.path === path)),
  );
}
