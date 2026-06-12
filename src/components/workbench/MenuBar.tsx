import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getAll, subscribe } from '../../commands/registry';
import { useVaultStore } from '../../stores/useVaultStore';
import Menu from '../common/Menu';
import { MENUS, toEntries } from './menuConfig';

/**
 * VSCode 式文字菜单框架（D-02）：嵌入自绘 TitleBar 左槽，项 13px、内边距 0 8px、
 * 高度占满可点（不挂 drag-region）；顶层键盘左右切换，registry.subscribe 驱动可用态。
 */
export default function MenuBar() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [, setVersion] = useState(0);
  const anchors = useRef<(HTMLButtonElement | null)[]>([]);
  const recent = useVaultStore((s) => s.recentVaults);

  useEffect(() => subscribe(() => setVersion((v) => v + 1)), []);

  const commands = new Map(getAll().map((c) => [c.id, c]));

  // 顶层左右切换：Menu 未消费的 ArrowLeft/ArrowRight 冒泡到此
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (openIndex === null) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    setOpenIndex((openIndex + delta + MENUS.length) % MENUS.length);
  };

  return (
    <div data-testid="menu-bar" role="menubar" className="flex h-full" onKeyDown={onKeyDown}>
      {MENUS.map((group, index) => (
        <div key={group.label} className="relative h-full">
          <button
            ref={(el) => {
              anchors.current[index] = el;
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openIndex === index}
            onClick={() => setOpenIndex(openIndex === index ? null : index)}
            onMouseEnter={() => {
              if (openIndex !== null && openIndex !== index) setOpenIndex(index);
            }}
            className={`h-full px-2 text-[13px] text-[var(--text-normal)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--background-modifier-hover)] ${
              openIndex === index ? 'bg-[var(--background-modifier-active)]' : ''
            }`}
          >
            {group.label}
          </button>
          {openIndex === index ? (
            <Menu
              items={toEntries(group, commands, recent)}
              label={group.label}
              onClose={() => setOpenIndex(null)}
              anchorRef={{ current: anchors.current[index] ?? null }}
              className="absolute top-full left-0 mt-px"
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
