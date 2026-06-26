import { useEffect, useState } from 'react';
import { rankCommands } from '../../commands/match';
import * as mru from '../../commands/mru';
import { execute, getAll, subscribe } from '../../commands/registry';
import { useContentSearchStore } from '../../stores/useContentSearchStore';
import { useOutlineStore } from '../../stores/useOutlineStore';
import { usePaletteStore } from '../../stores/usePaletteStore';
import { usePandocStore } from '../../stores/usePandocStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useVaultStore } from '../../stores/useVaultStore';
import type { PaletteProvider } from '../../types/commands';
import { contentProvider } from './contentProvider';
import { fileProvider } from './fileProvider';
import { headingProvider } from './headingProvider';
import PaletteInput from './PaletteInput';
import PaletteList from './PaletteList';
import './palette.css';

const HINT_NO_PREFIX = '输入 “>” 命令 · “#” 全文 · “@” 标题';
const HINT_NO_RESULT = '没有匹配的命令';
const HINT_QUICK_OPEN_NO_RESULT = '没有匹配的文件';
const HINT_NO_HEADING = '没有匹配的标题';
const HINT_NO_OUTLINE = '当前文档没有标题';

/** 「>」命令 provider：rankCommands 过滤 + MRU 置顶（D-07，无分组标题）。 */
const commandProvider: PaletteProvider = {
  prefix: '>',
  getItems: (query) => {
    // 简易模式隐藏高级命令；系统未装 pandoc 隐藏 pandoc 格式导出命令。与菜单门控同源。
    const simpleMode = useSettingsStore.getState().simpleMode;
    const pandocAvailable = usePandocStore.getState().available;
    const available = getAll().filter(
      (c) => !(simpleMode && c.advanced) && !(c.pandocOnly && !pandocAvailable),
    );
    return rankCommands(query.trim(), available, mru.list()).map(({ id, title, shortcut }) => ({
      id,
      title,
      shortcut,
    }));
  },
};

/**
 * 前缀路由表（D-06）：`>` 命令 / `#` 全文 / `@` 标题 + 无前缀快速打开 fileProvider，壳不改。
 * 各前缀首字符互异（routeProvider 取首个 startsWith 命中）。
 */
const providers: PaletteProvider[] = [commandProvider, headingProvider, contentProvider, fileProvider];

/**
 * 前缀路由（D-06）：有前缀走匹配前缀的 provider；无前缀（快速打开 Ctrl+P）且已打开
 * vault 时回退到无前缀 fileProvider（FILE-03）。无 vault 的无前缀输入仍回退命令提示。
 */
function routeProvider(query: string): PaletteProvider | undefined {
  const prefixed = providers.find((p) => p.prefix !== '' && query.startsWith(p.prefix));
  if (prefixed) return prefixed;
  if (useVaultStore.getState().vault) return fileProvider;
  return undefined;
}

/** `#` 全文搜索空态文案：依次判简易模式 / 无 vault / 短词（trigram <3）/ 搜索中 / 无结果。 */
function contentPlaceholder(rawTerm: string, loading: boolean, count: number): string | null {
  if (useSettingsStore.getState().simpleMode) return '简易模式未启用全文索引';
  if (!useVaultStore.getState().vault) return '请先打开一个文件夹作为工作区';
  if (rawTerm.trim().length < 3) return '全文搜索请至少输入 3 个字符';
  if (loading && count === 0) return '搜索中…';
  if (count === 0) return '没有匹配的内容';
  return null;
}

/** 路由到具体 provider 后的空态文案（命令 / 快速打开 / 标题各自措辞，与门控同源）。 */
function resultPlaceholder(provider: PaletteProvider): string {
  if (provider === fileProvider) return HINT_QUICK_OPEN_NO_RESULT;
  if (provider === headingProvider) {
    return useOutlineStore.getState().items.length === 0 ? HINT_NO_OUTLINE : HINT_NO_HEADING;
  }
  return HINT_NO_RESULT;
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
  // pandoc 启动探测异步 resolve 后重算列表，使 pandoc 格式命令的显隐与菜单同步（与 MenuBar 同纪律）。
  useEffect(() => usePandocStore.subscribe(() => setVersion((v) => v + 1)), []);
  // 全文搜索结果异步落地（contentProvider 同步读 store）：store 变更即重渲染列表/空态。
  useEffect(() => useContentSearchStore.subscribe(() => setVersion((v) => v + 1)), []);
  useEffect(() => setSelectedIndex(0), [query]);

  // `#` 全文搜索驱动：防抖 160ms 触发 FTS5 查询；离开 `#` 模式即清空（作废在途查询）。
  const contentTerm = query.startsWith('#') ? query.slice(1).trim() : null;
  useEffect(() => {
    if (contentTerm === null) {
      useContentSearchStore.getState().clear();
      return;
    }
    const handle = setTimeout(() => void useContentSearchStore.getState().run(contentTerm), 160);
    return () => clearTimeout(handle);
  }, [contentTerm]);

  const provider = routeProvider(query);
  const items = provider ? provider.getItems(query.slice(provider.prefix.length)) : [];
  const selected = Math.min(selectedIndex, Math.max(0, items.length - 1));
  const placeholder =
    provider === undefined
      ? HINT_NO_PREFIX
      : provider === contentProvider
        ? contentPlaceholder(query.slice(1), useContentSearchStore.getState().loading, items.length)
        : items.length === 0
          ? resultPlaceholder(provider)
          : null;

  const runItem = (index: number) => {
    const item = items[index];
    if (item === undefined || provider === undefined) return;
    // 文件 provider 提供 onSelect（打开文件）；命令 provider 缺省走 registry.execute。
    if (provider.onSelect) provider.onSelect(item.id);
    else void execute(item.id);
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
