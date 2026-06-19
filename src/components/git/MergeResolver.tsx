import { GitMerge, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  assembleResolution,
  conflictCount,
  parseConflicts,
  type ConflictChoice,
  type MergePart,
} from '../../diff/parseConflicts';
import { proseDiff, type ProseStatus } from '../../diff/proseDiff';
import { abortOp } from '../../editor/gitActions';
import { gitReadConflict, gitResolveConflict } from '../../ipc/git';
import { useGitStore } from '../../stores/useGitStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { showToast } from '../../stores/useToastStore';

function segStyle(status: ProseStatus): React.CSSProperties {
  if (status === 'insert') return { background: 'var(--graph-diff-add-bg)' };
  if (status === 'delete')
    return { background: 'var(--graph-diff-del-bg)', textDecoration: 'line-through' };
  return {};
}

const CHOICES: Array<{ key: ConflictChoice; label: string }> = [
  { key: 'ours', label: '采纳本方' },
  { key: 'theirs', label: '采纳对方' },
  { key: 'both', label: '两者都要' },
];

/** 单冲突块：句级 diff（ours↔theirs，删=本方独有、增=对方独有）+ 采纳选择。 */
function ConflictCard({
  part,
  choice,
  onChoose,
}: {
  part: Extract<MergePart, { kind: 'conflict' }>;
  choice: ConflictChoice;
  onChoose: (c: ConflictChoice) => void;
}) {
  const segs = useMemo(() => proseDiff(part.ours, part.theirs), [part.ours, part.theirs]);
  return (
    <div className="my-2 rounded-[4px] border border-[var(--accent)] p-2">
      <div className="mb-1.5 flex items-center gap-1 text-[12px] text-[var(--text-muted)]">
        <GitMerge size={12} aria-hidden="true" />
        <span>冲突（本方 ↔ 对方）</span>
        <div className="ml-auto flex gap-1">
          {CHOICES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onChoose(c.key)}
              className={`rounded-[3px] px-1.5 py-0.5 text-[11px] ${
                choice === c.key
                  ? 'bg-[var(--accent)] text-[var(--background-primary)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--text-normal)]">
        {segs.map((s, i) => (
          <span key={i} className="rounded-[2px] px-0.5" style={segStyle(s.status)}>
            {s.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * prose 三向合并解决器（Phase 12 DIFF-03，中央覆盖视图）。左栏列冲突文件；右栏把 git 合并产物按
 * 标记切成干净段（原样）与冲突块，对每块用句级 diff 呈现本方↔对方差异并按块采纳，组装写回 + git add。
 * 全部解决后该文件离开冲突列表；列表空 → 提示去 git 面板提交。打开不抢编辑器焦点（IME 安全）。
 */
export default function MergeResolver() {
  const repoRoot = useGitStore((s) => s.repoRoot);
  const files = useGitStore((s) => s.status?.files ?? []);
  const conflicted = useMemo(() => files.filter((f) => f.status === 'conflicted'), [files]);
  const setCentralView = useWorkbenchStore((s) => s.setCentralView);

  const [selected, setSelected] = useState<string | null>(null);
  const [parts, setParts] = useState<MergePart[]>([]);
  const [choices, setChoices] = useState<ConflictChoice[]>([]);
  const [busy, setBusy] = useState(false);

  // 默认选中首个冲突文件；冲突列表变化时若当前选中已解决则换选。
  useEffect(() => {
    if (conflicted.length === 0) {
      setSelected(null);
      return;
    }
    if (!selected || !conflicted.some((f) => f.path === selected)) {
      setSelected(conflicted[0].path);
    }
  }, [conflicted, selected]);

  // 读取并解析选中文件。
  useEffect(() => {
    if (!repoRoot || !selected) {
      setParts([]);
      setChoices([]);
      return;
    }
    let cancelled = false;
    void gitReadConflict(repoRoot, selected)
      .then((content) => {
        if (cancelled) return;
        const p = parseConflicts(content);
        setParts(p);
        setChoices(Array.from({ length: conflictCount(p) }, () => 'ours'));
      })
      .catch((e) => {
        if (!cancelled) showToast('error', e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repoRoot, selected]);

  const save = async (): Promise<void> => {
    if (!repoRoot || !selected || busy) return;
    // 入口快照路径与内容，贯穿整个 await——避免期间冲突列表变化改写 selected/parts 致写错文件。
    const path = selected;
    const content = assembleResolution(parts, choices);
    setBusy(true);
    try {
      await gitResolveConflict(repoRoot, path, content);
      await useGitStore.getState().refresh();
      setSelected(null); // 该文件离开冲突列表即为反馈（ToastKind 仅 error/warning）
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const abortMerge = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      if (await abortOp()) setCentralView('editor'); // 仅中止成功才回编辑器，失败留在解决器
    } finally {
      setBusy(false);
    }
  };

  let conflictIdx = -1;

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--background-modifier-border)] px-2">
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <GitMerge size={14} aria-hidden="true" />
          <span>合并冲突解决 · {conflicted.length} 个文件待解决</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void abortMerge()}
            className="rounded px-2 py-0.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:opacity-50"
          >
            中止合并
          </button>
          <button
            type="button"
            title="关闭（回编辑器）"
            onClick={() => setCentralView('editor')}
            className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      {conflicted.length === 0 ? (
        <div className="flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]">
          全部冲突已解决，请在左下角 git 面板提交合并结果。
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-56 shrink-0 overflow-auto border-r border-[var(--background-modifier-border)]">
            {conflicted.map((f) => (
              <button
                key={f.path}
                type="button"
                disabled={busy}
                onClick={() => setSelected(f.path)}
                className={`block w-full truncate px-3 py-2 text-left text-[13px] ${
                  selected === f.path
                    ? 'bg-[var(--background-modifier-active)] text-[var(--text-normal)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
                }`}
                title={f.path}
              >
                {f.path}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {parts.map((p, i) => {
                if (p.kind === 'clean') {
                  if (!p.text.trim()) return null;
                  return (
                    <div
                      key={i}
                      className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--text-muted)]"
                    >
                      {p.text}
                    </div>
                  );
                }
                conflictIdx += 1;
                const idx = conflictIdx;
                return (
                  <ConflictCard
                    key={i}
                    part={p}
                    choice={choices[idx] ?? 'ours'}
                    onChoose={(c) =>
                      setChoices((prev) => {
                        const next = [...prev];
                        next[idx] = c;
                        return next;
                      })
                    }
                  />
                );
              })}
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-[var(--background-modifier-border)] px-3 py-2">
              <span className="text-[12px] text-[var(--text-muted)]">
                {conflictCount(parts)} 处冲突
              </span>
              <button
                type="button"
                disabled={busy || !selected}
                onClick={() => void save()}
                className="rounded-[4px] bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-[var(--background-primary)] disabled:opacity-50"
              >
                保存并标记解决
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
