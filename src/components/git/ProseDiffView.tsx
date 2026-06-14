import { useMemo } from 'react';
import { proseDiff, type ProseDiffSegment } from '../../diff/proseDiff';
import type { FileDiff } from '../../types/git';

/**
 * Prose Diff 视图（Phase 7 DIFF-02）：句级语义高亮，看「哪句话改了」而非「哪行变了」。
 *
 * 不传全文（DIFF 准则）：直接从已加载的结构化 hunks 重建变更区的 old/new 文本
 * （' '|'-' → old，' '|'+' → new），过 proseDiff 句级流水线。改写句成对呈现（删红删除线 + 增绿）。
 * 大文档 Worker 化 + 按章切片为后续增强（当前单文件主线程足够）。
 */

/** 从 hunks 重建变更区 old/new 文本（保留行序；剥尾换行）。 */
function reconstruct(fd: FileDiff): { oldText: string; newText: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const h of fd.hunks) {
    for (const ln of h.lines) {
      const c = ln.content.replace(/\n$/, '');
      if (ln.origin !== '+') oldLines.push(c); // 上下文 + 删除
      if (ln.origin !== '-') newLines.push(c); // 上下文 + 新增
    }
  }
  return { oldText: oldLines.join('\n'), newText: newLines.join('\n') };
}

function segStyle(status: ProseDiffSegment['status']): React.CSSProperties {
  if (status === 'insert') return { background: 'var(--graph-diff-add-bg)' };
  if (status === 'delete')
    return { background: 'var(--graph-diff-del-bg)', textDecoration: 'line-through' };
  return {};
}

export default function ProseDiffView({ fileDiff }: { fileDiff: FileDiff }) {
  const segs = useMemo(() => {
    if (fileDiff.binary) return null;
    const { oldText, newText } = reconstruct(fileDiff);
    return proseDiff(oldText, newText);
  }, [fileDiff]);

  if (segs === null) {
    return <div className="p-3 text-[13px] text-[var(--text-muted)]">二进制文件，不显示 diff</div>;
  }
  if (segs.length === 0) {
    return <div className="p-3 text-[13px] text-[var(--text-muted)]">无文本变更</div>;
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto p-3 text-[13px] leading-relaxed">
      {segs.map((s, i) => {
        // 段落变化时换行分段（render 按段分组）。
        const br = i > 0 && s.para !== segs[i - 1].para;
        return (
          <span key={i}>
            {br ? <span className="block h-2" /> : null}
            <span
              className="break-words rounded-[2px] px-0.5 text-[var(--text-normal)]"
              style={segStyle(s.status)}
            >
              {s.text}
            </span>
          </span>
        );
      })}
    </div>
  );
}
