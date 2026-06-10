import { useEffect, useRef } from 'react';
import type { PaletteItem } from '../../types/commands';
import Kbd from '../common/Kbd';

interface PaletteRowProps {
  item: PaletteItem;
  selected: boolean;
  onSelect: () => void;
}

/**
 * 命令面板结果行（UI-SPEC 行规格）：行高 32、文本 13、水平内边距 12；
 * 选中 = hover 背景 + 2px 左侧 accent 条（accent 保留清单第 3 项）；选中态即焦点表达。
 */
export default function PaletteRow({ item, selected, onSelect }: PaletteRowProps) {
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  return (
    <li
      ref={ref}
      role="option"
      aria-selected={selected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      className={`flex h-8 cursor-pointer items-center gap-2 px-3 text-[13px] text-[var(--text-normal)] ${
        selected
          ? 'border-l-2 border-l-[var(--accent)] bg-[var(--background-modifier-hover)]'
          : 'border-l-2 border-l-transparent hover:bg-[var(--background-modifier-hover)]'
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.shortcut !== undefined && <Kbd tone="faint">{item.shortcut}</Kbd>}
    </li>
  );
}
