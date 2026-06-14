import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { ROW_H, graphWidth, layoutGraph } from './layoutGraph';
import CommitRow from './CommitRow';
import GraphCanvas from './GraphCanvas';
import GitContextMenu from '../GitContextMenu';
import { useGitGraphStore } from '../../../stores/useGitGraphStore';
import { useGitStore } from '../../../stores/useGitStore';
import type { CommitInfo, GitRef } from '../../../types/git';

/** 右键菜单态：坐标 + 命中提交 + 该提交的 refs。 */
interface MenuState {
  x: number;
  y: number;
  oid: string;
  refs: GitRef[];
}

/**
 * 图谱栏主体（git-graph 重构 + W5 Find）：左侧整图单 SVG（GraphCanvas）叠在虚拟化文字行之上；
 * Find Widget（W5）= 顶部浮层搜索框，按信息/作者/hash 匹配 → 高亮全部命中 + ↑↓ 跳转滚动选中。
 * 滚动容器铁律（记忆 inkstream-table-zettlr #17）：唯一滚动祖先在 parentRef，内部不再嵌滚动。
 */

/** unix 秒 → 本地短日期+时分（绝对）。 */
function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** unix 秒 → 相对时间（'3 天前'）。Repository Settings 的日期格式选项（W5）。 */
function formatRelative(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return '刚刚';
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/** 提交是否命中查询（信息/作者含子串，或 oid 前缀）。q 已 lower。 */
function isMatch(c: CommitInfo, q: string): boolean {
  return (
    c.summary.toLowerCase().includes(q) ||
    c.authorName.toLowerCase().includes(q) ||
    c.oid.toLowerCase().startsWith(q)
  );
}

export default function CommitGraphList() {
  const commits = useGitGraphStore((s) => s.commits);
  const refs = useGitGraphStore((s) => s.refs);
  const selectedOid = useGitGraphStore((s) => s.selectedOid);
  const selectCommit = useGitGraphStore((s) => s.selectCommit);
  const findOpen = useGitGraphStore((s) => s.findOpen);
  const setFindOpen = useGitGraphStore((s) => s.setFindOpen);
  const dateRelative = useGitGraphStore((s) => s.dateRelative);
  const currentBranch = useGitStore((s) => s.status?.branch ?? null);
  const parentRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const gw = graphWidth(layout.laneCount);
  const refsByOid = useMemo(() => {
    const m = new Map<string, GitRef[]>();
    for (const r of refs) {
      const arr = m.get(r.targetOid);
      if (arr) arr.push(r);
      else m.set(r.targetOid, [r]);
    }
    return m;
  }, [refs]);

  // 匹配的 commit 下标 + oid 集（高亮用）。
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: number[] = [];
    commits.forEach((c, i) => {
      if (isMatch(c, q)) out.push(i);
    });
    return out;
  }, [commits, query]);
  const matchSet = useMemo(() => new Set(matches.map((i) => commits[i]?.oid)), [matches, commits]);

  const virt = useVirtualizer({
    count: commits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
  });

  // findOpen → 聚焦输入。
  useEffect(() => {
    if (findOpen) findInputRef.current?.focus();
  }, [findOpen]);

  /** 跳到第 idx 行：滚动居中 + 选中。 */
  const goto = (commitIndex: number): void => {
    virt.scrollToIndex(commitIndex, { align: 'center' });
    const oid = commits[commitIndex]?.oid;
    if (oid) selectCommit(oid);
  };

  const onQuery = (q: string): void => {
    setQuery(q);
    const ql = q.trim().toLowerCase();
    setActiveIdx(0);
    if (!ql) return;
    const first = commits.findIndex((c) => isMatch(c, ql));
    if (first >= 0) goto(first);
  };

  const step = (delta: number): void => {
    if (matches.length === 0) return;
    const next = (activeIdx + delta + matches.length) % matches.length;
    setActiveIdx(next);
    goto(matches[next]);
  };

  return (
    <div className="relative h-full">
      {findOpen ? (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-[6px] border border-[var(--background-modifier-border)] bg-[var(--background-secondary)] px-1.5 py-1 shadow-[0_2px_8px_rgb(0_0_0/0.25)]">
          <Search size={13} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            ref={findInputRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
              else if (e.key === 'Escape') setFindOpen(false);
            }}
            placeholder="搜索提交（信息/作者/hash）"
            className="w-44 bg-transparent text-[12px] text-[var(--text-normal)] outline-none placeholder:text-[var(--text-faint)]"
          />
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-faint)]">
            {query.trim() ? `${matches.length ? activeIdx + 1 : 0}/${matches.length}` : ''}
          </span>
          <button
            type="button"
            title="上一个 (Shift+Enter)"
            disabled={matches.length === 0}
            onClick={() => step(-1)}
            className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:opacity-40"
          >
            <ChevronUp size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="下一个 (Enter)"
            disabled={matches.length === 0}
            onClick={() => step(1)}
            className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:opacity-40"
          >
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            title="关闭 (Esc)"
            onClick={() => setFindOpen(false)}
            className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div ref={parentRef} className="h-full overflow-x-hidden overflow-y-auto">
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((vi) => {
            const cmt = commits[vi.index];
            if (!cmt) return null;
            return (
              <div
                key={cmt.oid}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <CommitRow
                  graphWidth={gw}
                  refs={refsByOid.get(cmt.oid) ?? []}
                  currentBranch={currentBranch}
                  summary={cmt.summary}
                  author={cmt.authorName}
                  date={dateRelative ? formatRelative(cmt.authorTime) : formatDate(cmt.authorTime)}
                  selected={cmt.oid === selectedOid}
                  matched={matchSet.has(cmt.oid)}
                  onClick={() => selectCommit(cmt.oid)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    selectCommit(cmt.oid);
                    setMenu({ x: e.clientX, y: e.clientY, oid: cmt.oid, refs: refsByOid.get(cmt.oid) ?? [] });
                  }}
                />
              </div>
            );
          })}
          <GraphCanvas layout={layout} />
        </div>
      </div>
      {menu ? (
        <GitContextMenu
          position={{ x: menu.x, y: menu.y }}
          oid={menu.oid}
          refs={menu.refs}
          currentBranch={currentBranch}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}
