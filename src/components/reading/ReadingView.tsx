import { BookOpen, ChevronLeft, ChevronRight, Library, List, X } from 'lucide-react';
import { useState } from 'react';
import { exitReading } from '../../bookshelf/exitReading';
import { addFileToShelf } from '../../bookshelf/importBooks';
import { goChapter } from '../../bookshelf/openBook';
import { isShelfFormat } from '../../editor/reading/openReading';
import { readingScrollTo } from '../../editor/reading/readingNav';
import { useBookshelfStore } from '../../stores/useBookshelfStore';
import { useReadingStore } from '../../stores/useReadingStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { showToast } from '../../stores/useToastStore';
import type { ReadingGenre, ReadingTheme } from '../../types/reading';
import HtmlReader from './HtmlReader';
import PdfReader from './PdfReader';
import ReadingBookmarks from './ReadingBookmarks';
import ReadingSettingsMenu from './ReadingSettingsMenu';
import ReadingTocPanel from './ReadingTocPanel';
import { ICON_BTN, NAV_BTN, Segmented } from './readingControls';

/**
 * 阅读模式覆盖层（FEAT-READ）：顶部工具栏（文体 / 配色分段控件 + 字号 + 关闭）+ 正文区。
 * 覆盖层盖住三栏（编辑器不卸载，保 CM 实例 / IME），编辑功能天然不可达。txt/md/docx/epub → HtmlReader，pdf → PdfReader。
 * 分段控件样式取自落地页阅读演示：文体「小说/文献」、配色「亮/护眼/夜间」一目了然，当前项高亮。
 */
const GENRES: { id: ReadingGenre; label: string }[] = [
  { id: 'novel', label: '小说' },
  { id: 'literature', label: '文献' },
];
const THEMES: { id: ReadingTheme; label: string }[] = [
  { id: 'light', label: '亮' },
  { id: 'sepia', label: '护眼' },
  { id: 'dark', label: '夜间' },
];
export default function ReadingView() {
  const doc = useReadingStore((s) => s.doc);
  const genre = useReadingStore((s) => s.genre);
  const theme = useReadingStore((s) => s.prefs.theme);
  const toc = useReadingStore((s) => s.toc);
  const setGenre = useReadingStore((s) => s.setGenre);
  const setTheme = useReadingStore((s) => s.setTheme);
  const ctx = useReadingStore((s) => s.bookContext);
  const bookshelfEnabled = useSettingsStore((s) => s.bookshelfEnabled);
  const [tocOpen, setTocOpen] = useState(false);
  // 响应式订阅在架态：加入书架后即时隐藏「加入书架」按钮（doc 可能为 null，守卫后再判）。
  const shelved = useBookshelfStore((s) =>
    doc ? s.books.some((b) => b.rootPath === doc.path || b.volumes.some((v) => v.chapters.some((c) => c.path === doc.path))) : false,
  );
  if (!doc) return null;
  // md 可进阅读但不入书架（isShelfFormat 排除）：否则按钮显示却点了无反馈（addFileToShelf 对 md 返 false）。
  const canShelve = bookshelfEnabled && !ctx && !shelved && isShelfFormat(doc.path);

  const shelveCurrent = async (): Promise<void> => {
    if (await addFileToShelf(doc.path)) showToast('warning', '已加入书架。');
  };

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <BookOpen size={14} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{doc.name}</span>
        </div>
        {ctx ? (
          <div className="flex shrink-0 items-center gap-1 text-[12px] text-[var(--text-muted)]">
            <button type="button" className={NAV_BTN} title="上一章" aria-label="上一章" disabled={ctx.index <= 0} onClick={() => goChapter(-1)}>
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <span className="tabular-nums">第 {ctx.index + 1}/{ctx.chapters.length} 章</span>
            <button type="button" className={NAV_BTN} title="下一章" aria-label="下一章" disabled={ctx.index >= ctx.chapters.length - 1} onClick={() => goChapter(1)}>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <Segmented label="文体" value={genre} options={GENRES} onPick={setGenre} />
        <Segmented label="配色" value={theme} options={THEMES} onPick={setTheme} />
        {doc.format !== 'pdf' ? <ReadingSettingsMenu /> : null}
        {doc.format !== 'pdf' && toc.length > 0 ? (
          <button
            type="button"
            className={`shrink-0 ${ICON_BTN} ${tocOpen ? 'bg-[var(--background-modifier-active)] text-[var(--text-normal)]' : ''}`}
            title="目录"
            aria-label="目录"
            aria-pressed={tocOpen}
            onClick={() => setTocOpen((o) => !o)}
          >
            <List size={15} aria-hidden="true" />
          </button>
        ) : null}
        {doc.format !== 'pdf' ? <ReadingBookmarks path={doc.path} /> : null}
        {canShelve ? (
          <button type="button" className={`shrink-0 ${ICON_BTN}`} title="加入书架" aria-label="加入书架" onClick={() => void shelveCurrent()}>
            <Library size={15} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" className={ICON_BTN} title="关闭（回编辑器）" aria-label="关闭阅读" onClick={() => void exitReading()}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        {doc.format !== 'pdf' && tocOpen && toc.length > 0 ? (
          <ReadingTocPanel toc={toc} onJump={(i) => readingScrollTo(i)} onClose={() => setTocOpen(false)} />
        ) : null}
        <div className="min-h-0 flex-1">
          {doc.format === 'pdf' ? <PdfReader doc={doc} /> : <HtmlReader doc={doc} />}
        </div>
      </div>
    </div>
  );
}
