import { AlertCircle, Quote } from 'lucide-react';
import { useCitationStore } from '../../stores/useCitationStore';

/**
 * StatusBar 引用指示（Phase 8 ACAD-03）：当前文档引用数 + 未解析警告。
 * 数据源 useCitationStore（editor/citations.ts 单向镜像 + CitationPanel 解析填充 validKeys）。
 * 无引用时不显（保持状态栏简洁）；resolved 前不报未解析（避免误警）。
 */
export default function CitationIndicator() {
  const citations = useCitationStore((s) => s.citations);
  const validKeys = useCitationStore((s) => s.validKeys);
  const resolved = useCitationStore((s) => s.resolved);

  if (citations.length === 0) return null;
  const valid = new Set(validKeys);
  const unresolved = resolved ? citations.filter((c) => !valid.has(c.key)).length : 0;

  return (
    <div
      className="flex h-full items-center gap-1.5 border-l border-[var(--background-modifier-border)] px-2"
      title={`文档引用 ${citations.length}${unresolved > 0 ? ` · ${unresolved} 个未解析` : ''}`}
    >
      <Quote size={12} aria-hidden="true" />
      <span>{citations.length}</span>
      {unresolved > 0 ? (
        <span className="flex items-center gap-0.5 text-[var(--color-error)]">
          <AlertCircle size={12} aria-hidden="true" />
          {unresolved}
        </span>
      ) : null}
    </div>
  );
}
