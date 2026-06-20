import { FilePlus2, FolderPlus, Library, X } from 'lucide-react';
import { importBookFiles, importBookFolder } from '../../bookshelf/importBooks';
import { useBookshelfStore } from '../../stores/useBookshelfStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import BookCard from './BookCard';

/**
 * 书架画廊覆盖层（FEAT-SHELF）：盖住三栏（编辑器不卸载，保 CM/IME），封面网格 + 进度 + 导入入口。
 * 由 bookshelfEnabled 设置门控（WorkbenchLayout 决定挂载）。配色全用 theme.css token。
 */
const BAR_BTN =
  'flex items-center gap-1.5 rounded-[6px] border border-[var(--background-modifier-border)] px-2.5 py-1 text-[12.5px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]';

export default function BookshelfView() {
  const books = useBookshelfStore((s) => s.books);
  const close = (): void => useWorkbenchStore.getState().setCentralView('editor');
  const sorted = [...books].sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] px-3">
        <Library size={15} aria-hidden="true" className="text-[var(--text-muted)]" />
        <span className="text-[13px] font-medium text-[var(--text-normal)]">书架</span>
        <span className="text-[12px] text-[var(--text-muted)]">{books.length} 本</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className={BAR_BTN} onClick={() => void importBookFiles()}>
            <FilePlus2 size={14} aria-hidden="true" />
            导入文件
          </button>
          <button type="button" className={BAR_BTN} onClick={() => void importBookFolder()}>
            <FolderPlus size={14} aria-hidden="true" />
            导入文件夹
          </button>
          <button
            type="button"
            className="ml-1 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
            title="关闭书架"
            aria-label="关闭书架"
            onClick={close}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {books.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
            <Library size={42} aria-hidden="true" className="opacity-50" />
            <p className="mt-2 text-[15px] text-[var(--text-normal)]">书架还是空的</p>
            <p className="text-[13px]">在阅读模式里「加入书架」，或点上方「导入文件 / 文件夹」。</p>
            <p className="text-[12px]">文件夹支持「书 → 卷 → 章」结构，自动识别。</p>
          </div>
        ) : (
          <div
            className="grid gap-x-5 gap-y-6"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}
          >
            {sorted.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
