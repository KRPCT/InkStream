import { GitMerge, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assembleResolution, conflictCount, type ConflictChoice, type ConflictPart, type ParsedConflicts } from '../../diff/parseConflicts';
import { comparisonDisplayText, plainComparison, type TextComparison } from '../../diff/compareText';
import { compareBranchText } from '../../editor/branchComparisonClient';
import { parseConflictDocument } from '../../editor/conflictParserClient';
import { abortOp } from '../../editor/gitActions';
import { resolveGitConflict } from '../../editor/gitConflictActions';
import { captureGitWorktreeScope, isCurrentGitScope, type GitWorktreeScope } from '../../editor/gitWorktreeMutation';
import { gitConflictSnapshot, gitConflictText } from '../../ipc/gitConflict';
import { useGitStore } from '../../stores/useGitStore';
import { useGitRebaseStore } from '../../stores/useGitRebaseStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { showToast } from '../../stores/useToastStore';
import type { GitFileStatus } from '../../types/git';
import type { ConflictBaseline } from '../../types/gitConflict';
import ReadOnlyGitText from './ReadOnlyGitText';
import RebaseControls from './RebaseControls';

const NO_FILES: GitFileStatus[] = [];
const button = 'rounded border border-[var(--background-modifier-border)] px-2 py-1 text-[12px] disabled:opacity-40';
interface LoadedConflict {
  scope: GitWorktreeScope; path: string; revision: number; operation: string;
  content: string; baseline: ConflictBaseline; parsed: ParsedConflicts; choices: (ConflictChoice | null)[];
}

function ConflictCard({ part, choice, choose, disabled, rebasing }: {
  part: ConflictPart; choice: ConflictChoice | null; choose: (value: ConflictChoice) => void; disabled: boolean; rebasing: boolean;
}) {
  const [calculated, setCalculated] = useState<{ part: ConflictPart; value: TextComparison } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void compareBranchText(comparisonDisplayText(part.ours), comparisonDisplayText(part.theirs), controller.signal).then((value) => {
      if (!controller.signal.aborted) setCalculated({ part, value });
    }).catch(() => undefined);
    return () => controller.abort();
  }, [part]);
  const comparison = calculated?.part === part ? calculated.value : plainComparison('正在计算差异，完整两侧可阅读。');
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="flex flex-wrap gap-2 text-[12px]">
      {(['ours', 'theirs', 'both'] as const).map((value) => <button key={value} className={button} disabled={disabled} aria-pressed={choice === value} onClick={() => choose(value)}>
        {value === 'both' ? '两者都要' : value === 'ours' ? rebasing ? '采纳目标分支' : '采纳本方' : rebasing ? '采纳正在重放的提交' : '采纳对方'}
      </button>)}
      <span role="status">{comparison.note}</span>
    </div>
    {part.base !== null ? <section className="h-36 shrink-0 border border-[var(--background-modifier-border)]"><p className="px-2 text-[12px]">共同基线（diff3）</p><div className="h-28"><ReadOnlyGitText text={part.base} label="当前冲突共同基线" /></div></section> : null}
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
      <section className="flex min-h-0 flex-col border border-[var(--background-modifier-border)]"><p className="px-2 text-[12px]">{rebasing ? '目标分支及已重放提交' : '本方'}</p><div className="min-h-0 flex-1"><ReadOnlyGitText text={part.ours} label="冲突本方完整正文" ranges={comparison.oldRanges} /></div></section>
      <section className="flex min-h-0 flex-col border border-[var(--background-modifier-border)]"><p className="px-2 text-[12px]">{rebasing ? '正在重放的提交' : '对方'}</p><div className="min-h-0 flex-1"><ReadOnlyGitText text={part.theirs} label="冲突对方完整正文" side="new" ranges={comparison.newRanges} /></div></section>
    </div>
  </div>;
}

export default function MergeResolver() {
  const repoRoot = useGitStore((state) => state.repoRoot);
  const vault = useVaultStore((state) => state.vault);
  const files = useGitStore((state) => state.status?.files ?? NO_FILES);
  const rebase = useGitRebaseStore();
  const rebasing = rebase.scope?.vault === vault && rebase.scope?.repoRoot === repoRoot && rebase.status?.inProgress === true;
  const operation = rebasing ? `${rebase.status?.originalHead}:${rebase.status?.onto}:${rebase.status?.currentCommit}:${rebase.status?.step}` : '';
  const conflicted = useMemo(() => files.filter((file) => file.status === 'conflicted'), [files]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedConflict | null>(null);
  const [revision, setRevision] = useState(0);
  const [active, setActive] = useState(0);
  const [view, setView] = useState<'conflicts' | 'working' | 'base' | 'ours' | 'theirs'>('conflicts');
  const [error, setError] = useState('');
  const [base, setBase] = useState<{ document: LoadedConflict; part: 'base' | 'ours' | 'theirs'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef<AbortController | null>(null);
  const document = loaded && loaded.scope.repoRoot === repoRoot && loaded.scope.vault === vault && loaded.path === selected && loaded.revision === revision && loaded.operation === operation ? loaded : null;
  const blocks = document?.parsed.kind === 'valid' ? document.parsed.parts.filter((part): part is ConflictPart => part.kind === 'conflict') : [];
  const block = blocks[active];
  const valid = document?.parsed.kind === 'valid';
  const ready = document?.parsed.kind === 'valid' && document.choices.every((choice) => choice !== null);
  useEffect(() => () => saving.current?.abort(), []);
  useEffect(() => {
    if (!conflicted.length) setSelected(null);
    else if (!selected || !conflicted.some((file) => file.path === selected)) setSelected(conflicted[0].path);
  }, [conflicted, selected]);
  useEffect(() => {
    setLoaded(null); setError(''); setBase(null); setActive(0); setView('conflicts');
    const scope = captureGitWorktreeScope();
    if (!repoRoot || !selected || scope?.repoRoot !== repoRoot) return;
    const controller = new AbortController();
    void (async () => {
      const snapshot = await gitConflictSnapshot(repoRoot, selected);
      const content = await gitConflictText(repoRoot, selected, snapshot.baseline, 'working', controller.signal);
      let parsed: ParsedConflicts;
      try { parsed = snapshot.markerError ? { kind: 'invalid', error: snapshot.markerError, line: 0 } : await parseConflictDocument(content, controller.signal); }
      catch (reason) { parsed = { kind: 'invalid', error: String(reason), line: 0 }; }
      if (controller.signal.aborted || !isCurrentGitScope(scope)) return;
      setLoaded({ scope, path: selected, revision, operation, content, baseline: snapshot.baseline, parsed, choices: Array.from({ length: conflictCount(parsed) }, () => null) });
    })().catch((reason: unknown) => { if (!controller.signal.aborted && isCurrentGitScope(scope)) setError(String(reason)); });
    return () => controller.abort();
  }, [repoRoot, selected, vault, revision, operation]);
  useEffect(() => {
    if (view === 'working' || view === 'conflicts' || !document) return;
    const controller = new AbortController();
    const snapshot = document;
    void gitConflictText(snapshot.scope.repoRoot, snapshot.path, snapshot.baseline, view, controller.signal).then((text) => {
      if (!controller.signal.aborted && isCurrentGitScope(snapshot.scope)) setBase({ document: snapshot, part: view, text });
    }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [view, document]);

  const save = async () => {
    if (!document || !ready || busy || rebase.busy) return;
    const snapshot = document;
    const controller = new AbortController();
    saving.current = controller;
    setBusy(true);
    try {
      const content = assembleResolution(snapshot.parsed, snapshot.choices);
      if (await resolveGitConflict(snapshot.scope, snapshot.path, snapshot.content, content, snapshot.baseline, controller.signal)) setSelected(null);
    } catch (reason) { if (!controller.signal.aborted) showToast('error', String(reason)); }
    finally { saving.current = null; setBusy(false); }
  };
  const abort = async () => { setBusy(true); try { if (await abortOp()) useWorkbenchStore.getState().setCentralView('editor'); } finally { setBusy(false); } };
  return <div className="flex h-full flex-col bg-[var(--background-primary)] text-[var(--text-normal)]">
    <RebaseControls showResolve={false} />
    <header className="flex shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] p-2 text-[12px]">
      <GitMerge size={14} /><span>{rebasing ? '变基冲突解决' : '合并冲突解决'} · {conflicted.length} 个文件待解决</span>
      <span className="flex-1" />
      {!rebasing ? <button className={button} disabled={busy} onClick={() => void abort()}>中止合并</button> : null}
      <button title="关闭（回编辑器）" onClick={() => useWorkbenchStore.getState().setCentralView('editor')}><X size={14} /></button>
    </header>
    {!conflicted.length ? <p className="p-3 text-[13px]">{rebasing ? '全部冲突已标记解决，请继续变基。' : '全部冲突已解决，请在源代码管理面板提交。'}</p> : <div className="flex min-h-0 flex-1">
      <aside className="w-48 shrink-0 overflow-auto border-r border-[var(--background-modifier-border)]">
        {conflicted.map((file) => <button key={file.path} className="block w-full break-all p-2 text-left text-[12px]" disabled={busy} aria-pressed={selected === file.path} onClick={() => setSelected(file.path)}>{file.path}</button>)}
      </aside>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3">
        {error ? <p role="alert" className="text-[13px]">{error}</p> : null}
        {!document && !error ? <p role="status">正在读取当前冲突文件…</p> : null}
        {document ? <>
          <div className="flex flex-wrap gap-2">
            <button className={button} onClick={() => setView('conflicts')}>逐处解决</button>
            <button className={button} onClick={() => setView('working')}>完整合并原文</button>
            <button className={button} disabled={!document.baseline.stages[0]} onClick={() => setView('base')}>完整共同基线</button>
            <button className={button} onClick={() => setView('ours')}>完整本方版本{document.baseline.stages[1] ? '' : '（无文件）'}</button>
            <button className={button} onClick={() => setView('theirs')}>完整对方版本{document.baseline.stages[2] ? '' : '（无文件）'}</button>
            {!document.baseline.stages[0] ? <span className="text-[12px]">Git 未提供完整共同基线（例如双方独立新增）。</span> : null}
          </div>
          {document.parsed.kind === 'invalid' ? <p role="alert">{document.parsed.error}</p> : null}
          {view === 'working' || (!valid && view === 'conflicts') ? <div className="min-h-0 flex-1"><ReadOnlyGitText text={document.content} label="完整冲突原文" /></div>
            : view !== 'conflicts' ? base?.document === document && base.part === view ? <div className="min-h-0 flex-1"><ReadOnlyGitText text={base.text} label={view === 'base' ? '完整共同基线' : view === 'ours' ? '完整本方版本' : '完整对方版本'} /></div> : <p role="status">正在读取固定冲突版本…</p>
              : block ? <>
                <div className="flex items-center gap-2 text-[12px]"><button className={button} disabled={active === 0} onClick={() => setActive((value) => value - 1)}>上一处</button><span>{active + 1} / {blocks.length}</span><button className={button} disabled={active >= blocks.length - 1} onClick={() => setActive((value) => value + 1)}>下一处</button><span>已选择 {document.choices.filter(Boolean).length} 处</span></div>
                <ConflictCard part={block} choice={document.choices[active]} rebasing={rebasing} disabled={busy || rebase.busy} choose={(choice) => setLoaded((previous) => previous === document ? { ...previous, choices: previous.choices.map((value, index) => index === active ? choice : value) } : previous)} />
              </> : <p className="text-[13px]">正文中已无冲突标记，可核对完整原文后标记解决。</p>}
        </> : null}
        <footer className="mt-auto flex shrink-0 items-center gap-2 border-t border-[var(--background-modifier-border)] pt-2 text-[12px]">
          <span>{document?.parsed.kind === 'invalid' ? '标记损坏' : `${blocks.length} 处冲突`}</span><span className="flex-1" />
          <button className={button} disabled={busy || rebase.busy || !selected} onClick={() => setRevision((value) => value + 1)}>重新读取冲突</button>
          {busy ? <button className={button} onClick={() => saving.current?.abort()}>取消保存</button> : null}
          <button className={button} disabled={busy || rebase.busy || !ready} onClick={() => void save()}>保存并标记解决</button>
        </footer>
      </main>
    </div>}
  </div>;
}
