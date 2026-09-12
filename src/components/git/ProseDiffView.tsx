import { useEffect, useMemo, useState } from 'react';
import { comparisonDisplayText, plainComparison, type TextComparison } from '../../diff/compareText';
import { compareBranchText } from '../../editor/branchComparisonClient';
import type { FileDiff } from '../../types/git';
import ReadOnlyGitText from './ReadOnlyGitText';

/** Existing patch views retain every supplied line; sentence calculation is bounded in a worker. */
export default function ProseDiffView({ fileDiff }: { fileDiff: FileDiff }) {
  const text = useMemo(() => {
    const old: string[] = [], next: string[] = [];
    for (const hunk of fileDiff.hunks) for (const line of hunk.lines) {
      if (line.origin !== '+') old.push(line.content);
      if (line.origin !== '-') next.push(line.content);
    }
    return { old: comparisonDisplayText(old.join('')), next: comparisonDisplayText(next.join('')) };
  }, [fileDiff]);
  const [loaded, setLoaded] = useState<{ text: typeof text; value: TextComparison } | null>(null);
  useEffect(() => {
    if (fileDiff.binary) return;
    const controller = new AbortController();
    void compareBranchText(text.old, text.next, controller.signal).then((value) => {
      if (!controller.signal.aborted) setLoaded({ text, value });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [text, fileDiff.binary]);
  if (fileDiff.binary) return <p className="p-3 text-[13px]">二进制文件，不显示文本差异。</p>;
  const comparison = loaded?.text === text ? loaded.value : plainComparison('正在计算句级差异，正文可阅读。');
  return <div className="flex h-full min-h-0 flex-col">
    <p role="status" className="shrink-0 p-2 text-[12px]">{comparison.note}</p>
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
      <ReadOnlyGitText text={text.old} label="基线差异正文" ranges={comparison.oldRanges} />
      <ReadOnlyGitText text={text.next} label="目标差异正文" side="new" ranges={comparison.newRanges} />
    </div>
  </div>;
}
