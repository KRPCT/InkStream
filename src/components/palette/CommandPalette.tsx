import { useEffect, useState } from 'react';
import { rankCommands } from '../../commands/match';
import * as mru from '../../commands/mru';
import { execute, getAll, subscribe } from '../../commands/registry';
import { usePaletteStore } from '../../stores/usePaletteStore';
import type { PaletteProvider } from '../../types/commands';
import PaletteInput from './PaletteInput';
import PaletteList from './PaletteList';
import './palette.css';

const HINT_NO_PREFIX = '输入 “>” 以搜索并执行命令';
const HINT_NO_RESULT = '没有匹配的命令';

/** 「>」命令 provider：rankCommands 过滤 + MRU 置顶（D-07，无分组标题）。 */
const commandProvider: PaletteProvider = {
  prefix: '>',
  getItems: (query) =>
    rankCommands(query.trim(), getAll(), mru.list()).map(({ id, title, shortcut }) => ({
      id,
      title,
      shortcut,
    })),
};

/** 前缀路由表（D-06）：Phase 2 在此追加无前缀快速打开 provider，壳不改。 */
const providers: PaletteProvider[] = [commandProvider];

function routeProvider(query: string): PaletteProvider | undefined {
  return providers.find((p) => p.prefix !== '' && query.startsWith(p.prefix));
}

/** 统一弹层（SHELL-04）：App 永挂载，open 控制显隐；关闭即时卸载内容。 */
export default function CommandPalette() {
  const open = usePaletteStore((s) => s.open);
  if (!open) return null;
  return <PalettePanel />;
}

function PalettePanel() {
  const query = usePaletteStore((s) => s.query);
  const setQuery = usePaletteStore((s) => s.setQuery);
  const closePalette = usePaletteStore((s) => s.closePalette);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [, setVersion] = useState(0);

  // 注册表变更时刷新列表（菜单/命令在面板开启期间增删的边界情形）
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), []);
  useEffect(() => setSelectedIndex(0), [query]);

  const provider = routeProvider(query);
  const items = provider ? provider.getItems(query.slice(provider.prefix.length)) : [];
  const selected = Math.min(selectedIndex, Math.max(0, items.length - 1));
  const placeholder =
    provider === undefined ? HINT_NO_PREFIX : items.length === 0 ? HINT_NO_RESULT : null;

  const runItem = (index: number) => {
    const item = items[index];
    if (item === undefined) return;
    void execute(item.id);
    closePalette();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length === 0) return;
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex((selected + delta + items.length) % items.length);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === 'Enter') {
      // Pitfall 4：IME 组合上屏的 Enter 不执行命令
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      runItem(selected);
    }
  };

  return (
    <div className="fixed inset-0 z-50" role="presentation" onMouseDown={closePalette}>
      <div
        role="dialog"
        aria-label="命令面板"
        onMouseDown={(e) => e.stopPropagation()}
        className="palette-pop w-[560px] overflow-hidden rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] [box-shadow:var(--shadow-popup)]"
      >
        <PaletteInput value={query} onChange={setQuery} onKeyDown={onKeyDown} />
        <PaletteList
          items={items}
          selectedIndex={selected}
          placeholder={placeholder}
          onSelect={runItem}
        />
      </div>
    </div>
  );
}
