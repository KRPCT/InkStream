import { BookText, ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { execute } from '../../commands/registry';
import Menu, { type MenuEntry } from '../common/Menu';

/**
 * 学术工具栏「参考文献」下拉（Phase 8 ZOT-04）：默认项插入/刷新（GB/T 7714），
 * 其下三式直接按指定样式展开。每项经 registry.execute 走命令通道（与命令面板同源 D-02）。
 */

const ENTRIES: { id: string; label: string }[] = [
  { id: 'academic.bibliography', label: '插入 / 刷新（默认 GB/T 7714）' },
  { id: 'academic.biblio-gbt7714', label: 'GB/T 7714' },
  { id: 'academic.biblio-apa', label: 'APA' },
  { id: 'academic.biblio-vancouver', label: 'Vancouver' },
];

export default function BibliographyMenuButton() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const items: MenuEntry[] = ENTRIES.map((e) => ({
    id: e.id,
    label: e.label,
    onSelect: () => void execute(e.id),
  }));

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        title="参考文献"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
      >
        <BookText size={14} strokeWidth={1.75} aria-hidden="true" />
        参考文献
        <ChevronDown size={12} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open ? (
        <Menu
          items={items}
          label="参考文献格式"
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
          className="absolute top-full left-0 mt-1"
        />
      ) : null}
    </div>
  );
}
