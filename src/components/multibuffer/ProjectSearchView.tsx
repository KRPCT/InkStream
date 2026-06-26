import { FileText, Replace, Search, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { openFileAtOffset } from '../../editor/fileOpenFlow';
import { excerptSegments, type ExcerptModel } from '../../editor/multibuffer/projectSearch';
import { replaceAllInProject } from '../../editor/multibuffer/replaceAll';
import { confirmDestructive } from '../../stores/useConfirmStore';
import { useProjectSearchStore } from '../../stores/useProjectSearchStore';
import { showToast } from '../../stores/useToastStore';
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
  const [replaceInput, setReplaceInput] = useState('');
  const [replacing, setReplacing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 进入即聚焦搜索框（普通 input，非 CM contenteditable，不涉 WebView2 IME 纪律）。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onReplaceAll = async (): Promise<void> => {
    if (results.length === 0 || replacing) return;
    // 确认框打开期间即置 replacing（按钮随之禁用），杜绝期间重复触发；取消/完成都在 finally 复位。
    setReplacing(true);
    try {
      // 结果被截断时如实告知：只替换已列出的文件，库中可能还有未显示的命中需再次替换。
      const note = truncated
        ? '\n注意：结果过多已截断，本次只替换已列出的文件，可能仍有未显示的命中需再次替换。'
        : '';
      const ok = await confirmDestructive({
        title: '全库替换',
        body: `将在 ${results.length} 个文件中替换 ${totalMatches} 处「${query}」为「${replaceInput || '（空）'}」。撤销为逐文件（在各自标签页 Ctrl+Z）；冲突中的文件会跳过。${note}`,
        confirmLabel: '全部替换',
      });
      if (!ok) return;
      const report = await replaceAllInProject(query, replaceInput);
      await run(query); // 刷新结果（替换后命中应消失，空结果即成功反馈）。
      // toast 仅 error/warning 两种：干净成功不打扰（结果刷新即反馈）；有跳过/失败才告警。
      if (report.skipped.length > 0 || report.failed.length > 0) {
        const parts = [`已替换 ${report.replaced} 处（${report.files} 文件）`];
        if (report.skipped.length > 0) parts.push(`跳过 ${report.skipped.length} 个（冲突中）`);
        if (report.failed.length > 0) parts.push(`失败 ${report.failed.length} 个`);
        showToast('warning', parts.join('，'));
      }
    } finally {
      setReplacing(false);
    }
  };

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
      <header className="flex-none border-b border-[var(--background-modifier-border)]">
        <div className="flex h-10 items-center gap-2 px-3">
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
        </div>
        <div className="flex h-9 items-center gap-2 px-3 pb-1">
          <Replace size={15} className="flex-none text-[var(--text-faint)]" aria-hidden />
          <input
            value={replaceInput}
            onChange={(e) => setReplaceInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="替换为…"
            aria-label="替换为"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-normal)] outline-none placeholder:text-[var(--text-faint)]"
          />
          <button
            type="button"
            onClick={() => void onReplaceAll()}
            disabled={results.length === 0 || replacing}
            className="flex-none rounded-[4px] border border-[var(--background-modifier-border)] px-2 py-0.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {replacing ? '替换中…' : '全部替换'}
          </button>
        </div>
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
