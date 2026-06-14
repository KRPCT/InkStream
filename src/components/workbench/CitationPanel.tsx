import { useCallback, useEffect } from 'react';
import { AlertCircle, Quote, RefreshCw } from 'lucide-react';
import { zoteroCitekeys } from '../../ipc/zotero';
import { useCitationStore } from '../../stores/useCitationStore';
import { showToast } from '../../stores/useToastStore';
import EmptyState from '../common/EmptyState';

/**
 * Citation Panel（Phase 8 ZOT-03，RightPanel 引用 tab）：列当前文档全部 `[@citekey]`（去重+计数），
 * 未在 Zotero 库中的标红（未解析）。citations 由 editor/citations.ts 单向镜像；validKeys 经
 * zotero_citekeys 解析（挂载 + 手动刷新）。resolved 前不判红（避免未解析即误标）。
 */

function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}

export default function CitationPanel() {
  const citations = useCitationStore((s) => s.citations);
  const validKeys = useCitationStore((s) => s.validKeys);
  const resolved = useCitationStore((s) => s.resolved);
  const setValidKeys = useCitationStore((s) => s.setValidKeys);

  const resolve = useCallback(async () => {
    try {
      setValidKeys(await zoteroCitekeys());
    } catch (e) {
      showToast('error', `解析引用失败：${errText(e)}`);
    }
  }, [setValidKeys]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  if (citations.length === 0) {
    return (
      <EmptyState
        icon={Quote}
        heading="暂无引用"
        body="在文档中插入 [@citekey] 后，引用条目会列在这里。"
      />
    );
  }

  const valid = new Set(validKeys);
  const unresolved = resolved ? citations.filter((c) => !valid.has(c.key)).length : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] px-3 text-[12px]">
        <span className="text-[var(--text-muted)]">引用 {citations.length}</span>
        {unresolved > 0 ? (
          <span className="flex items-center gap-1 text-[var(--color-error)]">
            <AlertCircle size={12} aria-hidden="true" />
            {unresolved} 未解析
          </span>
        ) : null}
        <button
          type="button"
          title="重新解析（从 Zotero 刷新 citekey）"
          onClick={() => void resolve()}
          className="ml-auto rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1">
        {citations.map((c) => {
          const isUnresolved = resolved && !valid.has(c.key);
          return (
            <li
              key={c.key}
              className="flex items-center gap-2 px-3 py-1 text-[13px]"
              title={isUnresolved ? '未在 Zotero 库中找到此 citekey' : c.key}
            >
              <span
                className="min-w-0 flex-1 truncate font-mono"
                style={{ color: isUnresolved ? 'var(--color-error)' : 'var(--text-normal)' }}
              >
                [@{c.key}]
              </span>
              {isUnresolved ? (
                <AlertCircle size={12} className="shrink-0 text-[var(--color-error)]" aria-hidden="true" />
              ) : null}
              {c.count > 1 ? (
                <span className="shrink-0 rounded-full bg-[var(--background-modifier-active)] px-1.5 text-[11px] text-[var(--text-muted)]">
                  {c.count}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
