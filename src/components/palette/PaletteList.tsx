import type { PaletteItem } from '../../types/commands';
import PaletteRow from './PaletteRow';

interface PaletteListProps {
  items: PaletteItem[];
  selectedIndex: number;
  /** 非空时整个列表区只渲染该提示行（无前缀提示 / 无匹配结果）。 */
  placeholder: string | null;
  onSelect: (index: number) => void;
}

/** 命令面板结果列表：最多可见约 10 行（32px x 10 = 320px），超出滚动。 */
export default function PaletteList({
  items,
  selectedIndex,
  placeholder,
  onSelect,
}: PaletteListProps) {
  if (placeholder !== null) {
    return (
      <div className="flex h-8 items-center px-3 text-[13px] text-[var(--text-faint)]">
        {placeholder}
      </div>
    );
  }
  return (
    <ul role="listbox" aria-label="命令列表" className="max-h-[320px] overflow-y-auto">
      {items.map((item, i) => (
        <PaletteRow
          key={item.id}
          item={item}
          selected={i === selectedIndex}
          onSelect={() => onSelect(i)}
        />
      ))}
    </ul>
  );
}
