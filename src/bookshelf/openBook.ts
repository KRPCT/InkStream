import { openReading } from '../editor/reading/openReading';
import { useBookshelfStore } from '../stores/useBookshelfStore';
import { useReadingStore } from '../stores/useReadingStore';
import type { Book, BookChapter } from '../types/bookshelf';

/**
 * 书架打开 / 翻章 + 进度记录（FEAT-SHELF）。进度按书的 rootPath 键存，章节级推进。
 * 单文件书的精确页内进度由 PdfReader 另报（覆盖同键）；多章书以章索引为进度。
 */

/** 扁平化卷-章为线性章节列表。 */
export function flatChapters(book: Book): BookChapter[] {
  return book.volumes.flatMap((v) => v.chapters);
}

/** 章节级进度分数：多章按章推进（首章 0、末章 1），单章为 0（页内进度另报）。 */
function chapterFraction(index: number, total: number): number {
  return total > 1 ? index / (total - 1) : 0;
}

function recordProgress(rootPath: string, index: number, total: number): void {
  useBookshelfStore.getState().setProgress(rootPath, {
    fraction: chapterFraction(index, total),
    index,
    total,
    updatedAt: Date.now(),
  });
}

/** 从书架打开一本书：续读到上次章节（无则首章），设章节上下文并记进度。 */
export function openBook(book: Book): void {
  const chapters = flatChapters(book);
  if (chapters.length === 0) return;
  // 续读章索引：仅当存的 total 与章数吻合才信任为章索引（防单文件 PDF 的页索引被误当章索引）。
  const p = useBookshelfStore.getState().progress[book.rootPath];
  const saved = p && p.total === chapters.length ? p.index : 0;
  const index = Math.min(Math.max(0, saved), chapters.length - 1);
  const ch = chapters[index];
  openReading(ch.path, ch.title); // 清旧 bookContext + 设 doc / 视图
  useReadingStore.getState().setBookContext({ bookId: book.id, rootPath: book.rootPath, chapters, index });
  recordProgress(book.rootPath, index, chapters.length);
  useBookshelfStore.getState().touch(book.id);
}

/** 上/下一章（delta ±1）。越界忽略。 */
export function goChapter(delta: number): void {
  const ctx = useReadingStore.getState().bookContext;
  if (!ctx) return;
  const index = ctx.index + delta;
  if (index < 0 || index >= ctx.chapters.length) return;
  const ch = ctx.chapters[index];
  openReading(ch.path, ch.title);
  useReadingStore.getState().setBookContext({ ...ctx, index });
  recordProgress(ctx.rootPath, index, ctx.chapters.length);
}
