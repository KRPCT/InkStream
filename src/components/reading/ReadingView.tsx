import { BookOpen, ChevronLeft, ChevronRight, Library, Minus, Plus, X } from 'lucide-react';
import { exitReading } from '../../bookshelf/exitReading';
import { addFileToShelf } from '../../bookshelf/importBooks';
import { goChapter } from '../../bookshelf/openBook';
import { isShelfFormat } from '../../editor/reading/openReading';
import { useBookshelfStore } from '../../stores/useBookshelfStore';
import { useReadingStore } from '../../stores/useReadingStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { showToast } from '../../stores/useToastStore';
import type { ReadingGenre, ReadingTheme } from '../../types/reading';
import HtmlReader from './HtmlReader';
import PdfReader from './PdfReader';

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
const ICON_BTN =
  'rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]';
const NAV_BTN = `${ICON_BTN} disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent`;

/** 分段控件：一组互斥选项，当前项高亮（落地页阅读演示同款）。 */
function Segmented<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 overflow-hidden rounded-[7px] border border-[var(--background-modifier-border)]"
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
          className={`px-2.5 py-1 text-[12px] transition-colors ${
            i > 0 ? 'border-l border-[var(--background-modifier-border)]' : ''
          } ${
            value === o.id
              ? 'bg-[var(--background-modifier-active)] font-medium text-[var(--text-normal)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ReadingView() {
  const doc = useReadingStore((s) => s.doc);
  const genre = useReadingStore((s) => s.genre);
  const theme = useReadingStore((s) => s.prefs.theme);
  const setGenre = useReadingStore((s) => s.setGenre);
  const setTheme = useReadingStore((s) => s.setTheme);
  const bump = useReadingStore((s) => s.bumpFontSize);
  const ctx = useReadingStore((s) => s.bookContext);
  const bookshelfEnabled = useSettingsStore((s) => s.bookshelfEnabled);
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
        <div className="flex shrink-0 items-center">
          {canShelve ? (
            <button type="button" className={ICON_BTN} title="加入书架" aria-label="加入书架" onClick={() => void shelveCurrent()}>
              <Library size={15} aria-hidden="true" />
            </button>
          ) : null}
          <button type="button" className={ICON_BTN} title="缩小字号" aria-label="缩小字号" onClick={() => bump(-1)}>
            <Minus size={14} aria-hidden="true" />
          </button>
          <button type="button" className={ICON_BTN} title="放大字号" aria-label="放大字号" onClick={() => bump(1)}>
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        <button type="button" className={ICON_BTN} title="关闭（回编辑器）" aria-label="关闭阅读" onClick={() => void exitReading()}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {doc.format === 'pdf' ? <PdfReader doc={doc} /> : <HtmlReader doc={doc} />}
      </div>
    </div>
  );
}
