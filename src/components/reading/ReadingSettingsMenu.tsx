import { Minus, Plus, Type } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useReadingStore } from '../../stores/useReadingStore';
import type { ReadingFontFamily, ReadingMargin, ReadingWidth } from '../../types/reading';
import { ICON_BTN, Segmented } from './readingControls';

/**
 * 排版设置浮层（FEAT-READ 阅读器增强）：字体族 / 字号 / 版心宽度（文本重排）/ 页边距。
 * 仅对 HTML 类格式（txt/md/docx/epub）有效——PDF 为栅格画布，字体/宽度/边距不适用，故由 ReadingView 对 pdf 不渲染本菜单。
 * 改动即写 useReadingStore.prefs → HtmlReader 重建 iframe srcdoc 应用（并按锚点续读，不跳位）。
 */
const FONTS: { id: ReadingFontFamily; label: string }[] = [
  { id: 'auto', label: '跟随' },
  { id: 'serif', label: '衬线' },
  { id: 'sans', label: '无衬线' },
];
const WIDTHS: { id: ReadingWidth; label: string }[] = [
  { id: 'narrow', label: '窄' },
  { id: 'auto', label: '标准' },
  { id: 'wide', label: '宽' },
];
const MARGINS: { id: ReadingMargin; label: string }[] = [
  { id: 'compact', label: '紧凑' },
  { id: 'normal', label: '标准' },
  { id: 'roomy', label: '宽松' },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{label}</span>
      {children}
    </div>
  );
}

export default function ReadingSettingsMenu() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prefs = useReadingStore((s) => s.prefs);
  const bump = useReadingStore((s) => s.bumpFontSize);
  const setFontFamily = useReadingStore((s) => s.setFontFamily);
  const setWidth = useReadingStore((s) => s.setWidth);
  const setMargin = useReadingStore((s) => s.setMargin);

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

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        className={ICON_BTN}
        title="排版（字体 / 字号 / 宽度 / 边距）"
        aria-label="排版设置"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Type size={15} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="排版设置"
          className="absolute right-0 top-full z-50 mt-1 w-64 rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-3 py-2 [box-shadow:var(--shadow-popup)]"
        >
          <Row label="字体">
            <Segmented label="字体" value={prefs.fontFamily} options={FONTS} onPick={setFontFamily} />
          </Row>
          <Row label="字号">
            <div className="inline-flex items-center gap-1">
              <button type="button" className={ICON_BTN} title="缩小字号" aria-label="缩小字号" onClick={() => bump(-1)}>
                <Minus size={14} aria-hidden="true" />
              </button>
              <span className="w-6 text-center text-[12px] tabular-nums text-[var(--text-normal)]">{prefs.fontSize}</span>
              <button type="button" className={ICON_BTN} title="放大字号" aria-label="放大字号" onClick={() => bump(1)}>
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          </Row>
          <Row label="宽度">
            <Segmented label="版心宽度" value={prefs.width} options={WIDTHS} onPick={setWidth} />
          </Row>
          <Row label="页边距">
            <Segmented label="页边距" value={prefs.margin} options={MARGINS} onPick={setMargin} />
          </Row>
        </div>
      ) : null}
    </div>
  );
}
