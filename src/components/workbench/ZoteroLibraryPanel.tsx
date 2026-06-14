import { useCallback, useEffect, useState } from 'react';
import { BookMarked, RefreshCw } from 'lucide-react';
import { insertCitekey } from '../../editor/academicActions';
import { zoteroItems } from '../../ipc/zotero';
import type { ZoteroItem } from '../../types/zotero';

/**
 * Sidebar Zotero 文献库（Phase 8 ACAD-01）：Academic 模式 Sidebar 上半，列 Zotero 库条目（本地 BBT）。
 * 过滤 + 点击条目在编辑器光标处插入 `[@citekey]`（按文档语言重排）。连接态：未运行/无 BBT → 错误提示。
 * 离线全量缓存（Web API + SQLite）属 ZOT-02，本面板先经本地 BBT 实时取数。
 */

function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}

export default function ZoteroLibraryPanel() {
  const [items, setItems] = useState<ZoteroItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await zoteroItems());
    } catch (e) {
      setError(errText(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const q = filter.trim().toLowerCase();
  const shown = q
    ? items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.authors.toLowerCase().includes(q) ||
          i.citekey.toLowerCase().includes(q),
      )
    : items;

  return (
    <div className="flex shrink-0 flex-col border-b border-[var(--background-modifier-border)]">
      <div className="flex h-7 shrink-0 items-center gap-1 px-2 text-[12px]">
        <BookMarked size={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        <span className="font-medium text-[var(--text-normal)]">Zotero 文献库</span>
        <span className="text-[var(--text-faint)]">{error ? '未连接' : loading ? '…' : items.length}</span>
        <button
          type="button"
          title="刷新文献库"
          onClick={() => void load()}
          className="ml-auto rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
        >
          <RefreshCw size={12} aria-hidden="true" />
        </button>
      </div>
      {error ? (
        <div className="break-words px-2 pb-2 text-[12px] text-[var(--text-muted)]">{error}</div>
      ) : (
        <>
          {items.length > 0 ? (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="过滤文献…"
              className="mx-2 mb-1 rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-1.5 py-0.5 text-[12px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
            />
          ) : null}
          <ul className="max-h-[36vh] min-h-0 overflow-y-auto overflow-x-hidden pb-1">
            {shown.length === 0 ? (
              <li className="px-2 py-1 text-[12px] text-[var(--text-faint)]">
                {items.length === 0 ? '库为空' : '无匹配'}
              </li>
            ) : (
              shown.map((it) => (
                <li key={it.citekey}>
                  <button
                    type="button"
                    onClick={() => insertCitekey(it.citekey)}
                    title={`插入 [@${it.citekey}]`}
                    className="flex w-full flex-col items-start gap-0.5 px-2 py-1 text-left hover:bg-[var(--background-modifier-hover)]"
                  >
                    <span className="min-w-0 max-w-full truncate text-[12px] text-[var(--text-normal)]">
                      {it.title}
                    </span>
                    <span className="min-w-0 max-w-full truncate text-[11px] text-[var(--text-faint)]">
                      {[it.authors, it.year].filter(Boolean).join(' · ') || it.citekey}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}
