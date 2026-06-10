import { Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { execute } from '../../commands/registry';
import { MODE_PRESETS } from '../../modes/presets';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import type { AppMode } from '../../types/workbench';
import Menu, { type MenuEntry } from '../common/Menu';

const MODES: AppMode[] = ['standard', 'academic', 'creative'];

/**
 * StatusBar 模式指示器（D-08 常驻视觉锚点）：8px accent 圆点 + 模式名 12/400。
 * 点击弹出模式选择菜单：各模式静态身份色点（--mode-dot-*，保留清单第 6 条）
 * + label + 当前模式行尾 check；选择行经 registry.execute 走命令通道（MRU 一致）。
 */
export default function ModeIndicator() {
  const mode = useWorkbenchStore((s) => s.mode);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const items: MenuEntry[] = MODES.map((m) => ({
    id: m,
    label: MODE_PRESETS[m].label,
    leading: (
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: `var(--mode-dot-${m})` }}
      />
    ),
    trailing:
      m === mode ? (
        <Check
          size={16}
          strokeWidth={1.75}
          aria-hidden="true"
          data-testid="mode-check"
          className="text-[var(--text-normal)]"
        />
      ) : undefined,
    onSelect: () => void execute('mode.switch-' + m),
  }));

  return (
    <div className="relative h-full">
      <button
        ref={anchorRef}
        type="button"
        data-testid="mode-indicator"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-full items-center gap-1.5 px-2 text-[12px] font-normal transition-colors duration-[var(--duration-fast)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] ${
          open
            ? 'bg-[var(--background-modifier-active)] text-[var(--text-normal)]'
            : 'text-[var(--text-muted)]'
        }`}
      >
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
        <span>{MODE_PRESETS[mode].label}</span>
      </button>
      {open ? (
        <Menu
          items={items}
          label="模式选择"
          onClose={() => setOpen(false)}
          anchorRef={anchorRef}
          className="absolute right-0 bottom-full mb-1"
        />
      ) : null}
    </div>
  );
}
