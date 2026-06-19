import { BookOpen, Minus, Moon, Plus, Sun, X } from 'lucide-react';
import { closeReading } from '../../editor/reading/openReading';
import { useReadingStore } from '../../stores/useReadingStore';
import type { ReadingTheme } from '../../types/reading';
import HtmlReader from './HtmlReader';
import PdfReader from './PdfReader';

/**
 * 阅读模式覆盖层（FEAT-READ）：顶部极简工具栏（文体切换 / 字号 / 配色 / 关闭）+ 正文区。
 * 覆盖层盖住三栏（编辑器不卸载，保 CM 实例 / IME），编辑功能天然不可达。txt/docx/epub → HtmlReader，pdf → PdfReader。
 */
const THEME_CYCLE: ReadingTheme[] = ['light', 'sepia', 'dark'];
const BTN =
  'rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]';

export default function ReadingView() {
  const doc = useReadingStore((s) => s.doc);
  const genre = useReadingStore((s) => s.genre);
  const theme = useReadingStore((s) => s.prefs.theme);
  const setGenre = useReadingStore((s) => s.setGenre);
  const setTheme = useReadingStore((s) => s.setTheme);
  const bump = useReadingStore((s) => s.bumpFontSize);
  if (!doc) return null;

  const cycleTheme = (): void =>
    setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length]);

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--background-modifier-border)] px-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <BookOpen size={14} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{doc.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={BTN}
            title="文体：在 小说 / 文献 排版间切换"
            onClick={() => setGenre(genre === 'novel' ? 'literature' : 'novel')}
          >
            <span className="px-0.5 text-[12px]">{genre === 'novel' ? '小说' : '文献'}</span>
          </button>
          <button type="button" className={BTN} title="缩小字号" aria-label="缩小字号" onClick={() => bump(-1)}>
            <Minus size={14} aria-hidden="true" />
          </button>
          <button type="button" className={BTN} title="放大字号" aria-label="放大字号" onClick={() => bump(1)}>
            <Plus size={14} aria-hidden="true" />
          </button>
          <button type="button" className={BTN} title="切换阅读配色（亮/护眼/夜间）" aria-label="切换阅读配色" onClick={cycleTheme}>
            {theme === 'dark' ? <Moon size={14} aria-hidden="true" /> : <Sun size={14} aria-hidden="true" />}
          </button>
          <button type="button" className={BTN} title="关闭（回编辑器）" aria-label="关闭阅读" onClick={closeReading}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {doc.format === 'pdf' ? <PdfReader doc={doc} /> : <HtmlReader doc={doc} />}
      </div>
    </div>
  );
}
