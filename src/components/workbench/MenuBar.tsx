import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { execute, getAll, subscribe } from '../../commands/registry';
import type { Command } from '../../types/commands';
import Kbd from '../common/Kbd';
import Menu, { type MenuEntry } from '../common/Menu';

interface ItemConfig {
  commandId: string;
  /** 菜单短标签；缺省用 registry 的命令全称。 */
  label?: string;
}

interface GroupConfig {
  label: string;
  items: (ItemConfig | { label: string; submenu: ItemConfig[] })[];
}

/**
 * 菜单配置为纯数据（D-02 同源）：item 只存 commandId 与可选短标签，
 * 行为/标题/快捷键一律取自 registry——不在此定义任何 run。
 * Phase 6 挂 Git Graph 入口 = 注册命令 + 在此加一行。
 */
const MENUS: GroupConfig[] = [
  {
    label: '文件',
    items: [
      { commandId: 'file.open-folder', label: '打开文件夹…' },
      { commandId: 'app.exit', label: '退出' },
    ],
  },
  {
    label: '视图',
    items: [
      { commandId: 'view.command-palette', label: '命令面板' },
      { commandId: 'view.toggle-sidebar', label: '切换侧边栏' },
      { commandId: 'view.toggle-right-panel', label: '切换右侧面板' },
      {
        label: '外观',
        submenu: [
          { commandId: 'theme.light' },
          { commandId: 'theme.dark' },
          { commandId: 'theme.system' },
        ],
      },
      {
        label: '模式',
        submenu: [
          { commandId: 'mode.switch-standard' },
          { commandId: 'mode.switch-academic' },
          { commandId: 'mode.switch-creative' },
        ],
      },
    ],
  },
  { label: '帮助', items: [{ commandId: 'app.about', label: '关于 InkStream' }] },
];

function toEntry(cfg: ItemConfig, commands: Map<string, Command>): MenuEntry {
  const cmd = commands.get(cfg.commandId);
  return {
    id: cfg.commandId,
    label: cfg.label ?? cmd?.title ?? cfg.commandId,
    disabled: cmd === undefined,
    trailing: cmd?.shortcut ? <Kbd tone="faint">{cmd.shortcut}</Kbd> : undefined,
    onSelect: () => void execute(cfg.commandId),
  };
}

function toEntries(group: GroupConfig, commands: Map<string, Command>): MenuEntry[] {
  return group.items.map((item) =>
    'submenu' in item
      ? {
          id: `submenu-${item.label}`,
          label: item.label,
          submenu: item.submenu.map((sub) => toEntry(sub, commands)),
        }
      : toEntry(item, commands),
  );
}

/**
 * VSCode 式文字菜单框架（D-02）：嵌入自绘 TitleBar 左槽，项 13px、内边距 0 8px、
 * 高度占满可点（不挂 drag-region）；顶层键盘左右切换，registry.subscribe 驱动可用态。
 */
export default function MenuBar() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [, setVersion] = useState(0);
  const anchors = useRef<(HTMLButtonElement | null)[]>([]);

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
              items={toEntries(group, commands)}
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
