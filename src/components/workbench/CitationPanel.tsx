import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CloudOff, Quote, RefreshCw } from 'lucide-react';
import { onZoteroLibraryChanged, zoteroItemsResilient } from '../../ipc/zotero';
import { refreshCitationPreviews } from '../../editor/livepreview/citationPreview';
import { useCitationStore } from '../../stores/useCitationStore';
import { useEditorStore } from '../../stores/useEditorStore';
import EmptyState from '../common/EmptyState';

/**
 * 文档引用由共享模型镜像；已知键来自当前库的在线条目或离线缓存。
 * 读取期间不判定缺失，换账户/卸载后的迟到请求不能恢复旧库结果。
 */

function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}

export default function CitationPanel() {
  const paused = useEditorStore((s) => s.documentBudget?.mode === 'basic');
  const citations = useCitationStore((s) => s.citations);
  const validKeys = useCitationStore((s) => s.validKeys);
  const resolved = useCitationStore((s) => s.resolved);
  const setValidKeys = useCitationStore((s) => s.setValidKeys);
  const resetResolution = useCitationStore((s) => s.resetResolution);
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async (refresh = false) => {
    const current = ++request.current;
    resetResolution();
    setError(null); setOffline(false);
    if (refresh) refreshCitationPreviews();
    if (paused) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await zoteroItemsResilient();
      if (current !== request.current) return;
      setValidKeys([...new Set(result.items.map((item) => item.citekey))]);
      setOffline(result.offline);
    } catch (e) {
      if (current === request.current) setError(`解析引用失败：${errText(e)}`);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [setValidKeys, resetResolution, paused]);

  useEffect(() => {
    const unsubscribe = onZoteroLibraryChanged(() => { void resolve(); });
    void resolve();
    return () => { request.current += 1; unsubscribe(); };
  }, [resolve]);

  if (paused) {
    return <EmptyState icon={Quote} heading="引用分析已暂停" body="基础编辑模式下不自动扫描全文。可在状态栏启用完整排版。" />;
  }
  if (citations.length === 0) {
    return (
      <EmptyState
        icon={Quote}
        heading="暂无引用"
        body="Markdown、Typst 或 LaTeX 文档中的引用会列在这里。"
      />
    );
  }

  const valid = new Set(validKeys);
  const unresolved = resolved ? citations.filter((c) => !valid.has(c.key)).length : 0;

  return (
    <div className="flex h-full flex-col">
      {error ? <p role="status" className="px-3 py-2 text-[12px] text-[var(--color-error)]">{error}；尚未判定引用是否存在。</p> : null}
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] px-3 text-[12px]">
        <span className="text-[var(--text-muted)]">引用 {citations.length}</span>
        {loading ? <span role="status">解析中…</span> : null}
        {offline ? <span className="flex items-center gap-1"><CloudOff size={12} aria-hidden="true" />离线缓存</span> : null}
        {unresolved > 0 ? (
          <span className="flex items-center gap-1 text-[var(--color-error)]">
            <AlertCircle size={12} aria-hidden="true" />
            {unresolved} 未解析
          </span>
        ) : null}
        <button
          type="button"
          title="重新解析引用"
          disabled={loading}
          onClick={() => void resolve(true)}
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
