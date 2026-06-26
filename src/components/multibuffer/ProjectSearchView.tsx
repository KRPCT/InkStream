import { FileText, Search, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { openFileAtOffset } from '../../editor/fileOpenFlow';
import { excerptSegments, type ExcerptModel } from '../../editor/multibuffer/projectSearch';
import { useProjectSearchStore } from '../../stores/useProjectSearchStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import './multibuffer.css';

/**
 * 全库搜索结果视图（#2c 1b，中央区覆盖层）。
 *
 * 只读结果呈现（仿 DiffHunkView 自绘，不引第二个 CM 内核——行内可编辑摘录留待增量 2 才上次级 EditorView）。
 * 数据来自 useProjectSearchStore（trigram 召回 + 真相源重算命中）；点击命中 → 回编辑器并跳到该偏移
 * （openFileAtOffset，复用 #17 真实滚动容器 + 不抢编辑器焦点）。搜索框为普通 input，与 CM 的 WebView2 IME
 * 纪律无关，可正常聚焦。replace-all 回写见增量 1c。
 */
export default function ProjectSearchView() {
  const setCentralView = useWorkbenchStore((s) => s.setCentralView);
  const hasVault = useVaultStore((s) => s.vault !== null);
  const run = useProjectSearchStore((s) => s.run);
  const clear = useProjectSearchStore((s) => s.clear);
  const query = useProjectSearchStore((s) => s.query);
  const results = useProjectSearchStore((s) => s.results);
  const totalMatches = useProjectSearchStore((s) => s.totalMatches);
  const truncated = useProjectSearchStore((s) => s.truncated);
  const status = useProjectSearchStore((s) => s.status);
  const [input, setInput] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  // 进入即聚焦搜索框（普通 input，非 CM contenteditable，不涉 WebView2 IME 纪律）。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 防抖触发查询（180ms）。
  useEffect(() => {
    const h = setTimeout(() => void run(input), 180);
    return () => clearTimeout(h);
  }, [input, run]);

  const close = (): void => setCentralView('editor');

  const openMatch = (path: string, offset: number): void => {
    setCentralView('editor');
    void openFileAtOffset(path, offset);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      <header className="flex h-10 flex-none items-center gap-2 border-b border-[var(--background-modifier-border)] px-3">
        <Search size={15} className="flex-none text-[var(--text-faint)]" aria-hidden />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="全库搜索（工作区 .md，≥3 字）"
          aria-label="全库搜索"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-normal)] outline-none placeholder:text-[var(--text-faint)]"
        />
        {status === 'done' && results.length > 0 && (
          <span className="flex-none text-[12px] text-[var(--text-faint)]">
            {totalMatches} 处 · {results.length} 文件{truncated ? ' · 结果过多' : ''}
          </span>
        )}
        <button
          type="button"
          onClick={close}
          aria-label="关闭全库搜索"
          className="flex-none rounded-[4px] p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]"
        >
          <X size={15} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto py-1 text-[13px]">
        <Body
          hasVault={hasVault}
          query={query}
          status={status}
          results={results}
          truncated={truncated}
          onOpen={openMatch}
          onClear={() => {
            setInput('');
            clear();
          }}
        />
      </div>
    </div>
  );
}

interface BodyProps {
  hasVault: boolean;
  query: string;
  status: 'idle' | 'searching' | 'done';
  results: ReturnType<typeof useProjectSearchStore.getState>['results'];
  truncated: boolean;
  onOpen: (path: string, offset: number) => void;
  onClear: () => void;
}

/** 结果体：空态分级（无 vault / 短词 / 搜索中 / 无结果）或文件分组列表。 */
function Body({ hasVault, query, status, results, onOpen }: BodyProps) {
  if (!hasVault) return <Hint text="请先打开一个文件夹作为工作区，再全库搜索。" />;
  if (query.length < 3) {
    return <Hint text={query === '' ? '输入关键字，在工作区 .md 文件中搜索。' : '全库搜索请至少输入 3 个字符。'} />;
  }
  if (status === 'searching' && results.length === 0) return <Hint text="搜索中…" />;
  if (results.length === 0) return <Hint text={`未找到「${query}」。`} />;

  return (
    <>
      {results.map((fm) => (
        <section key={fm.path} className="mb-2">
          <button
            type="button"
            onClick={() => onOpen(fm.path, fm.excerpts[0]?.matches[0]?.from ?? 0)}
            title={fm.path}
            className="flex w-full items-center gap-1.5 px-3 py-1 text-left hover:bg-[var(--background-modifier-hover)]"
          >
            <FileText size={13} className="flex-none text-[var(--text-faint)]" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[var(--text-normal)]">{fm.path}</span>
            <span className="flex-none text-[12px] text-[var(--text-faint)]">{fm.matchCount}</span>
          </button>
          {fm.excerpts.map((ex, i) => (
            <button
              key={`${ex.sourceFrom}-${i}`}
              type="button"
              onClick={() => onOpen(fm.path, ex.matches[0]?.from ?? ex.sourceFrom)}
              className="flex w-full gap-2 px-3 py-0.5 text-left hover:bg-[var(--background-modifier-hover)]"
            >
              <span className="flex-none select-none text-right text-[11px] tabular-nums text-[var(--text-faint)]" style={{ minWidth: 28 }}>
                {ex.firstLine}
              </span>
              <code className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[12px] text-[var(--text-muted)]">
                <ExcerptText excerpt={ex} />
              </code>
            </button>
          ))}
        </section>
      ))}
    </>
  );
}

/** 摘录文本：命中片段包 <mark.mb-match>，其余原样（纯文本，无 innerHTML 注入面）。 */
function ExcerptText({ excerpt }: { excerpt: ExcerptModel }) {
  return (
    <>
      {excerptSegments(excerpt).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="mb-match">
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}

function Hint({ text }: { text: string }) {
  return <div className="px-3 py-6 text-center text-[13px] text-[var(--text-faint)]">{text}</div>;
}
