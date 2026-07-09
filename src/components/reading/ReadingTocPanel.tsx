import { X } from 'lucide-react';
import type { TocItem } from '../../types/reading';
import { ICON_BTN } from './readingControls';

/**
 * 目录侧栏（FEAT-READ 阅读器增强）：展示 HtmlReader 自动提取的标题，点击经 readingNav 跳转到对应内容块。
 * 按层级缩进；空目录时不由 ReadingView 渲染（按钮亦隐藏）。
 */
export default function ReadingTocPanel({
  toc,
  onJump,
  onClose,
}: {
  toc: TocItem[];
  onJump: (blockIndex: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r border-[var(--background-modifier-border)] bg-[var(--background-secondary)]">
      <div className="flex h-8 shrink-0 items-center justify-between pl-3 pr-1.5 text-[12px] font-medium text-[var(--text-muted)]">
        <span>目录</span>
        <button type="button" className={ICON_BTN} title="收起目录" aria-label="收起目录" onClick={onClose}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto pb-2" aria-label="文档目录">
        {toc.map((it) => (
          <button
            key={it.blockIndex}
            type="button"
            onClick={() => onJump(it.blockIndex)}
            title={it.text}
            style={{ paddingLeft: `${10 + (Math.min(it.level, 6) - 1) * 12}px` }}
            className="block w-full truncate py-1 pr-2 text-left text-[12px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            {it.text}
          </button>
        ))}
      </nav>
    </div>
  );
}
