import { Search, X } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { rankFiles } from '../palette/fileProvider';
import { openFileByPath } from '../../editor/fileOpenFlow';
import { useVaultStore } from '../../stores/useVaultStore';
import type { FileEntry } from '../../types/vault';

/**
 * 侧栏顶部常驻搜索框（R4 §4.2，Obsidian 式递归过滤）。
 *
 * 数据源用 useVaultStore.files 快照（openVault 时填充，watcher 变更后刷新）——递归整库，
 * 不受文件树折叠态限制（规避 VSCode filter-on-type 折叠漏文件硬伤，R4 §4.2 裁决）。
 * 排序复用 palette/fileProvider 的 rankFiles（CJK ufuzzy，D-07），绝不重写匹配。
 * 有查询 → Sidebar 切扁平结果列表（本组件的 SearchResults）；清空 → 恢复树视图（Sidebar 控制）。
 */

interface SearchBoxProps {
  query: string;
  onQueryChange: (q: string) => void;
}

/** 搜索输入：左置 Search 图标、清空按钮；Esc 清空（IME 组合期 Esc 仍清空，纯清状态不 dispatch）。 */
export function SidebarSearch({ query, onQueryChange }: SearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // IME 组合期 Enter 防御（铁律 isComposing||keyCode===229）：组合上屏的 Enter 绝不打开文件。
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const top = topResult(query);
      if (top) void openFileByPath(top.path);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onQueryChange('');
    }
  };

  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-[var(--background-modifier-border)] px-2">
      <Search size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" />
      <input
        ref={inputRef}
        id="sidebar-search-input"
        name="sidebar-search"
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="搜索文件"
        placeholder="搜索文件…"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-normal)] placeholder:text-[var(--text-faint)] focus:outline-none"
      />
      {query ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={() => onQueryChange('')}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
        >
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** 取当前查询的首个命中（Enter 打开首项用）。 */
function topResult(query: string): FileEntry | undefined {
  const { files } = useVaultStore.getState();
  return rankFiles(query, files)[0];
}

/**
 * 扁平结果列表（有查询时替换树视图）：文件名 + 相对路径副文本，点击经 fileOpenFlow 打开。
 * 排序经 rankFiles（与快速打开 Ctrl+P 同源）；空结果给提示文案。
 */
export function SearchResults({ query }: { query: string }) {
  const files = useVaultStore((s) => s.files);
  const results = rankFiles(query, files);

  if (results.length === 0) {
    return (
      <div className="px-3 py-2 text-[13px] text-[var(--text-faint)]" role="status">
        没有匹配的文件
      </div>
    );
  }

  return (
    <ul role="listbox" aria-label="搜索结果" className="overflow-auto py-1">
      {results.map((f) => (
        <li key={f.path}>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => void openFileByPath(f.path)}
            className="flex w-full flex-col items-start gap-0.5 px-3 py-1 text-left hover:bg-[var(--background-modifier-hover)]"
          >
            <span className="w-full truncate text-[13px] text-[var(--text-normal)]">{f.name}</span>
            <span className="w-full truncate text-[12px] text-[var(--text-faint)]">{f.path}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
