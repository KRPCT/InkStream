import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ROW_H, layoutGraph } from './layoutGraph';
import CommitRow from './CommitRow';
import GitContextMenu from '../GitContextMenu';
import { useGitGraphStore } from '../../../stores/useGitGraphStore';
import { useGitStore } from '../../../stores/useGitStore';
import type { GitRef } from '../../../types/git';

/** 右键菜单态：坐标 + 命中提交 + 该提交的 refs。 */
interface MenuState {
  x: number;
  y: number;
  oid: string;
  refs: GitRef[];
}

/**
 * 图谱栏主体（Phase 6 GIT-02）：虚拟化提交列表（@tanstack/react-virtual），每行 = lane SVG + 提交文字。
 * 布局是纯函数，commits 变才重算（useMemo）。滚动容器铁律（记忆 inkstream-table-zettlr #17）：
 * 唯一滚动祖先在此，内部不再嵌滚动。
 */

/** unix 秒 → 本地短日期+时分。 */
function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function CommitGraphList() {
  const commits = useGitGraphStore((s) => s.commits);
  const refs = useGitGraphStore((s) => s.refs);
  const selectedOid = useGitGraphStore((s) => s.selectedOid);
  const selectCommit = useGitGraphStore((s) => s.selectCommit);
  const currentBranch = useGitStore((s) => s.status?.branch ?? null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const refsByOid = useMemo(() => {
    const m = new Map<string, GitRef[]>();
    for (const r of refs) {
      const arr = m.get(r.targetOid);
      if (arr) arr.push(r);
      else m.set(r.targetOid, [r]);
    }
    return m;
  }, [refs]);

  const virt = useVirtualizer({
    count: commits.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 12, // 上下各多渲染，保跨行连线在视口边缘不断裂
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((vi) => {
          const cmt = commits[vi.index];
          const n = layout.nodes[vi.index];
          if (!cmt || !n) return null;
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
                node={n}
                segments={layout.segmentsByRow.get(vi.index) ?? []}
                laneCount={layout.laneCount}
                refs={refsByOid.get(cmt.oid) ?? []}
                currentBranch={currentBranch}
                summary={cmt.summary}
                author={cmt.authorName}
                date={formatDate(cmt.authorTime)}
                selected={cmt.oid === selectedOid}
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
