import { useEffect, useState } from 'react';
import { useGitGraphStore } from '../../stores/useGitGraphStore';
import { useGitStore } from '../../stores/useGitStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { gitCompareText } from '../../ipc/gitCompare';
import { compareBranchText } from '../../editor/branchComparisonClient';
import { comparisonDisplayText, type TextComparison } from '../../diff/compareText';
import type { GitCompareFile } from '../../types/gitCompare';
import ReadOnlyGitText from './ReadOnlyGitText';

export default function CommitFileComparison() {
  const root = useGitStore((state) => state.repoRoot);
  const vault = useVaultStore((state) => state.vault);
  const page = useGitGraphStore((state) => state.commitPage);
  const oid = useGitGraphStore((state) => state.selectedOid);
  const selected = useGitGraphStore((state) => state.selectedFile);
  const file = page?.toOid === oid ? page.files.find((entry) => (entry.new?.path ?? entry.old?.path) === selected) : undefined;
  const [loaded, setLoaded] = useState<{ file: GitCompareFile; old: string; next: string; comparison: TextComparison } | null>(null);
  const [error, setError] = useState<{ file: GitCompareFile; message: string } | null>(null);
  const [highlight, setHighlight] = useState(true);
  useEffect(() => {
    setLoaded(null); setError(null);
    if (!root || !file) return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && useGitStore.getState().repoRoot === root && useVaultStore.getState().vault === vault;
    void (async () => {
      const old = comparisonDisplayText(await gitCompareText(root, file.old, controller.signal));
      const next = comparisonDisplayText(await gitCompareText(root, file.new, controller.signal));
      if (!current()) return;
      const comparison = await compareBranchText(old, next, controller.signal);
      if (current()) setLoaded({ file, old, next, comparison });
    })().catch((reason: unknown) => { if (current()) setError({ file, message: String(reason) }); });
    return () => controller.abort();
  }, [root, vault, file]);
  if (!file) return <p className="p-3 text-[13px]">选择一个文件查看完整正文差异。</p>;
  if (error?.file === file) return <p role="alert" className="p-3">{error.message}</p>;
  if (loaded?.file !== file) return <p role="status" className="p-3">正在读取固定提交的完整正文…</p>;
  return <div className="flex h-full min-h-0 flex-col">
    <header className="shrink-0 border-b border-[var(--background-modifier-border)] p-2 text-[12px]"><p>{selected} · {oid?.slice(0, 10)} · 只读完整正文</p><p role="status">{loaded.comparison.note}</p><button onClick={() => setHighlight((value) => !value)}>{highlight ? '查看纯正文' : '显示句级差异'}</button></header>
    <div className="grid min-h-0 flex-1 grid-cols-2">
      <section className="flex min-h-0 min-w-0 flex-col border-r border-[var(--background-modifier-border)]"><p className="p-1 text-[12px]">首父基线{file.old ? '' : '（此侧无文件）'}</p><div className="min-h-0 flex-1"><ReadOnlyGitText text={loaded.old} label="提交基线完整正文" ranges={highlight ? loaded.comparison.oldRanges : undefined} /></div></section>
      <section className="flex min-h-0 min-w-0 flex-col"><p className="p-1 text-[12px]">所选提交{file.new ? '' : '（此侧无文件）'}</p><div className="min-h-0 flex-1"><ReadOnlyGitText text={loaded.next} label="所选提交完整正文" side="new" ranges={highlight ? loaded.comparison.newRanges : undefined} /></div></section>
    </div>
  </div>;
}
