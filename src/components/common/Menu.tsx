import { ChevronRight } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import './menu.css';

export interface MenuEntry {
  id: string;
  label: string;
  /** 行首图标（如模式身份色点）。 */
  leading?: ReactNode;
  /** 行尾装饰（如 check 图标、Kbd 快捷键芯片）。 */
  trailing?: ReactNode;
  disabled?: boolean;
  submenu?: MenuEntry[];
  onSelect?: () => void;
  /** 非交互分隔线（菜单分组用，VSCode/Typora 惯例）。键盘导航跳过。 */
  separator?: boolean;
}

interface MenuProps {
  items: MenuEntry[];
  /** 关闭本层菜单（Esc / 外点 / 选择后）。 */
  onClose: () => void;
  /** 叶子项选择后的关闭回调（子菜单链路传根级 close）；缺省即 onClose。 */
  onSelectClose?: () => void;
  /** 锚定定位类（调用方给绝对定位，如 'absolute bottom-full right-0 mb-1'）。 */
  className?: string;
  /** 锚元素：outside-click 判定豁免（锚的开合由其自身 onClick 切换）。 */
  anchorRef?: RefObject<HTMLElement | null>;
  label?: string;
}

/** 从 from 起按 delta 方向找下一个可用项（跳过 disabled / separator，环绕）。 */
function nextEnabled(items: MenuEntry[], from: number, delta: number): number {
  const n = items.length;
  let i = from < 0 && delta < 0 ? 0 : from;
  for (let step = 0; step < n; step += 1) {
    i = (i + delta + n) % n;
    if (!items[i].disabled && !items[i].separator) return i;
  }
  return from;
}

/**
 * 通用下拉菜单（UI-SPEC 弹出层契约）：行高 28、文本 13、8px 圆角、--shadow-popup、
 * Esc/外点关闭、Up/Down/Enter 键盘导航、悬停/ArrowRight/Enter 展开子菜单；
 * 开合动效走 --duration-base token（menu.css）。
 */
export default function Menu({
  items,
  onClose,
  onSelectClose,
  className = '',
  anchorRef,
  label,
}: MenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const [subOpen, setSubOpen] = useState<string | null>(null);
  const closeAfterSelect = onSelectClose ?? onClose;

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (anchorRef?.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onClose, anchorRef]);

  const selectItem = (item: MenuEntry): void => {
    if (item.disabled) return;
    if (item.submenu) {
      setSubOpen((cur) => (cur === item.id ? null : item.id));
      return;
    }
    item.onSelect?.();
    closeAfterSelect();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setActive((i) => nextEnabled(items, i, e.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const item = items[active];
      if (item) selectItem(item);
      return;
    }
    if (e.key === 'ArrowRight') {
      const item = items[active];
      if (item?.submenu && !item.disabled) {
        e.preventDefault();
        e.stopPropagation();
        setSubOpen(item.id);
      }
      return;
    }
    if (e.key === 'Escape' || e.key === 'ArrowLeft') {
      if (e.key === 'ArrowLeft' && !subOpen) return;
      e.preventDefault();
      e.stopPropagation();
      if (subOpen) setSubOpen(null);
      else onClose();
    }
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`menu-pop z-50 min-w-40 rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] py-1 [box-shadow:var(--shadow-popup)] ${className}`}
    >
      {items.map((item, index) =>
        item.separator ? (
          <hr
            key={item.id}
            role="separator"
            aria-orientation="horizontal"
            className="my-1 border-0 border-t border-[var(--background-modifier-border)]"
          />
        ) : (
        <div key={item.id} className="relative">
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            aria-haspopup={item.submenu ? 'menu' : undefined}
            aria-expanded={item.submenu ? subOpen === item.id : undefined}
            onMouseEnter={() => {
              setActive(index);
              setSubOpen(item.submenu && !item.disabled ? item.id : null);
            }}
            onClick={() => selectItem(item)}
            className={`flex h-7 w-full items-center gap-2 px-2 text-left text-[13px] whitespace-nowrap text-[var(--text-normal)] transition-colors duration-[var(--duration-fast)] active:bg-[var(--background-modifier-active)] disabled:cursor-default disabled:text-[var(--text-faint)] ${
              index === active && !item.disabled ? 'bg-[var(--background-modifier-hover)]' : ''
            }`}
          >
            {item.leading}
            <span className="flex-1">{item.label}</span>
            {item.trailing}
            {item.submenu ? (
              <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
            ) : null}
          </button>
          {item.submenu && subOpen === item.id ? (
            <Menu
              items={item.submenu}
              label={item.label}
              onClose={() => {
                setSubOpen(null);
                rootRef.current?.focus();
              }}
              onSelectClose={closeAfterSelect}
              className="absolute top-0 left-full -mt-1 ml-1"
            />
          ) : null}
        </div>
        ),
      )}
    </div>
  );
}
