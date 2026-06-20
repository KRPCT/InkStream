import { Trash2 } from 'lucide-react';
import { openBook } from '../../bookshelf/openBook';
import { useBookshelfStore } from '../../stores/useBookshelfStore';
import { confirmDestructive } from '../../stores/useConfirmStore';
import type { Book } from '../../types/bookshelf';

/**
 * 书架画廊一张书卡（FEAT-SHELF）：封面 + 标题 + 进度条 + 悬停移除。点封面打开（续读）。
 * 移除仅删索引、不动源文件。配色全用 theme.css token（封面图为导入时提取的 data: URI）。
 */
export default function BookCard({ book }: { book: Book }) {
  const progress = useBookshelfStore((s) => s.progress[book.rootPath]);
  const removeBook = useBookshelfStore((s) => s.removeBook);
  const chapterCount = book.volumes.reduce((n, v) => n + v.chapters.length, 0);
  const pct = progress ? Math.round(progress.fraction * 100) : 0;

  const remove = async (): Promise<void> => {
    const ok = await confirmDestructive({
      title: '从书架移除',
      body: `从书架移除《${book.title}》？只移除书架索引，不会删除原文件。`,
      confirmLabel: '移除',
    });
    if (ok) removeBook(book.id);
  };

  return (
    <div className="group relative flex flex-col">
      <button
        type="button"
        onClick={() => openBook(book)}
        title={`打开《${book.title}》`}
        className="relative block aspect-[3/4] w-full overflow-hidden rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-secondary)] transition-transform hover:-translate-y-0.5 [box-shadow:var(--shadow-popup)]"
      >
        {book.cover ? (
          <img src={book.cover} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <span className="flex h-full items-center justify-center p-3 text-center text-[13px] text-[var(--text-muted)]">
            {book.title}
          </span>
        )}
        {pct > 0 ? (
          <span className="absolute inset-x-0 bottom-0 block h-1 bg-[var(--background-modifier-border)]">
            <span className="block h-full bg-[var(--interactive-accent)]" style={{ width: `${pct}%` }} />
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => void remove()}
        aria-label="从书架移除"
        title="从书架移除"
        className="absolute right-1.5 top-1.5 hidden rounded border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-1 text-[var(--text-muted)] hover:text-[var(--text-normal)] group-hover:block"
      >
        <Trash2 size={13} aria-hidden="true" />
      </button>
      <p className="mt-1.5 truncate text-[13px] text-[var(--text-normal)]" title={book.title}>
        {book.title}
      </p>
      <p className="truncate text-[11px] text-[var(--text-muted)]">
        {book.kind === 'folder' ? `${book.volumes.length} 卷 ${chapterCount} 章` : book.format.toUpperCase()}
        {progress ? ` · 已读 ${pct}%` : ''}
      </p>
    </div>
  );
}
