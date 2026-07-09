import { Bookmark, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { readingPosition, readingScrollTo } from '../../editor/reading/readingNav';
import { useBookshelfStore } from '../../stores/useBookshelfStore';
import { showToast } from '../../stores/useToastStore';
import type { Bookmark as BookmarkModel } from '../../types/bookshelf';
import { ICON_BTN } from './readingControls';

/**
 * 书签下拉（FEAT-READ 阅读器增强）：添加当前阅读位置为命名书签、列表跳转、删除。
 * 位置经 readingNav.readingPosition() 捕获（当前视口顶端块 + 文本片段作标签），持久化到书架 store（跨会话保留）。
 * 仅 HTML 类阅读器（txt/md/docx/epub）可用——PDF 无块级 nav，由 ReadingView 对 pdf 不渲染本控件。
 */
const EMPTY: BookmarkModel[] = [];

export default function ReadingBookmarks({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bookmarks = useBookshelfStore((s) => s.bookmarks[path] ?? EMPTY);
  const addBookmark = useBookshelfStore((s) => s.addBookmark);
  const removeBookmark = useBookshelfStore((s) => s.removeBookmark);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const add = (): void => {
    const pos = readingPosition();
    if (!pos) {
      showToast('warning', '当前位置暂不可添加书签。');
      return;
    }
    addBookmark(path, {
      label: pos.label,
      index: pos.index,
      fraction: pos.total > 1 ? Math.min(1, pos.index / (pos.total - 1)) : 0,
      createdAt: Date.now(),
    });
    showToast('warning', '已添加书签。');
  };

  const jump = (bm: BookmarkModel): void => {
    readingScrollTo(bm.index);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        className={ICON_BTN}
        title="书签"
        aria-label="书签"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Bookmark size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label="书签"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] py-1 [box-shadow:var(--shadow-popup)]"
        >
          <button
            type="button"
            role="menuitem"
            onClick={add}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
          >
            <Plus size={14} aria-hidden="true" />
            添加当前位置
          </button>
          {bookmarks.length > 0 ? (
            <hr className="my-1 border-0 border-t border-[var(--background-modifier-border)]" />
          ) : (
            <div className="px-3 py-2 text-[12px] text-[var(--text-faint)]">暂无书签</div>
          )}
          <div className="max-h-64 overflow-y-auto">
            {bookmarks.map((bm) => (
              <div key={bm.createdAt} className="group flex items-center hover:bg-[var(--background-modifier-hover)]">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => jump(bm)}
                  title={bm.label}
                  className="flex min-w-0 flex-1 items-baseline gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--text-normal)]"
                >
                  <span className="shrink-0 tabular-nums text-[var(--text-muted)]">{Math.round(bm.fraction * 100)}%</span>
                  <span className="truncate">{bm.label}</span>
                </button>
                <button
                  type="button"
                  className={`mr-1 shrink-0 opacity-0 group-hover:opacity-100 ${ICON_BTN}`}
                  title="删除书签"
                  aria-label="删除书签"
                  onClick={() => removeBookmark(path, bm.createdAt)}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
