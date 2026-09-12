import { useEffect, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { compareBranchText } from '../../editor/branchComparisonClient';
import { createComparisonView, locateComparison, uniqueComparisonRange } from '../../editor/comparisonView';
import { currentComparisonDocument } from '../../editor/gitCompareActions';
import { comparisonDisplayText, type TextComparison } from '../../diff/compareText';
import { gitCompareFiles, gitCompareText } from '../../ipc/gitCompare';
import { useGitStore } from '../../stores/useGitStore';
import { useVaultStore } from '../../stores/useVaultStore';
import type { GitCompareFile, GitComparePage, GitComparison } from '../../types/gitCompare';
import type { BranchInfo } from '../../types/git';

interface Request { comparison: GitComparison; skip: number; focusPath: string | null; snippet: string }
interface Body { file: GitCompareFile; oldText: string; newText: string; comparison: TextComparison; snippet: string }
const STATUS = { added: '新增', deleted: '删除', renamed: '改名', modified: '修改', typechange: '类型变化', unchanged: '无差异' };
const buttonClass = 'rounded border border-[var(--background-modifier-border)] px-2 py-1 text-[12px] hover:bg-[var(--background-modifier-hover)] disabled:opacity-40';
const branchKey = (branch: BranchInfo) => `${branch.isRemote ? 'remote' : 'local'}:${branch.name}`;

function ComparisonText({ text, ranges, side, label, snippet, viewRef }: {
  text: string; ranges: TextComparison['oldRanges']; side: 'old' | 'new'; label: string; snippet: string;
  viewRef: React.MutableRefObject<EditorView | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const view = createComparisonView(host.current, text, ranges, side, label);
    viewRef.current = view;
    const target = uniqueComparisonRange(text, snippet) ?? ranges[0];
    if (target) locateComparison(view, target);
    return () => { viewRef.current = null; view.destroy(); };
  }, [text, ranges, side, label, snippet, viewRef]);
  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}

function BodyView({ body }: { body: Body }) {
  const oldView = useRef<EditorView | null>(null);
  const newView = useRef<EditorView | null>(null);
  const [change, setChange] = useState(0);
  const count = Math.max(body.comparison.oldRanges.length, body.comparison.newRanges.length);
  const locate = (next: number) => {
    setChange(next);
    const oldRange = body.comparison.oldRanges[next];
    const newRange = body.comparison.newRanges[next];
    if (oldRange && oldView.current) locateComparison(oldView.current, oldRange);
    if (newRange && newView.current) locateComparison(newView.current, newRange);
  };
  const located = !body.snippet || uniqueComparisonRange(body.oldText, body.snippet) || uniqueComparisonRange(body.newText, body.snippet);
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--background-modifier-border)] p-2 text-[12px]">
      <span role="status">{body.comparison.note}</span>
      {count > 0 ? <>
        <button className={buttonClass} disabled={change === 0} onClick={() => locate(change - 1)}>上一处</button>
        <span>{change + 1} / {count}</span>
        <button className={buttonClass} disabled={change >= count - 1} onClick={() => locate(change + 1)}>下一处</button>
      </> : null}
      {!located ? <span>编辑位置在提交中没有唯一对应文本，已定位第一处差异。</span> : null}
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-2">
      {(['old', 'new'] as const).map((side) => <section key={side} className="flex min-h-0 min-w-0 flex-col border-r border-[var(--background-modifier-border)]">
        <h3 className="shrink-0 truncate border-b border-[var(--background-modifier-border)] p-2 text-[12px]" title={body.file[side]?.path}>
          {side === 'old' ? '基线' : '目标'} · {body.file[side]?.path ?? '此侧无文件'} · 只读
        </h3>
        <ComparisonText text={side === 'old' ? body.oldText : body.newText} ranges={side === 'old' ? body.comparison.oldRanges : body.comparison.newRanges}
          side={side} label={side === 'old' ? '基线完整正文' : '目标完整正文'} snippet={body.snippet} viewRef={side === 'old' ? oldView : newView} />
      </section>)}
    </div>
  </div>;
}

export default function BranchCompareView() {
  const repoRoot = useGitStore((s) => s.repoRoot);
  const branches = useGitStore((s) => s.branches);
  const vault = useVaultStore((s) => s.vault);
  const [fromChoice, setFromChoice] = useState('');
  const [toChoice, setToChoice] = useState('');
  const [request, setRequest] = useState<Request | null>(null);
  const [page, setPage] = useState<{ request: Request; value: GitComparePage } | null>(null);
  const [selected, setSelected] = useState<GitCompareFile | null>(null);
  const [body, setBody] = useState<Body | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bodyError, setBodyError] = useState('');
  const [message, setMessage] = useState('');
  const defaultFrom = branches.find((b) => !b.isHead) ?? branches[0];
  const defaultTo = branches.find((b) => b.isHead) ?? branches[0];
  const fromName = fromChoice || (defaultFrom ? branchKey(defaultFrom) : '');
  const toName = toChoice || (defaultTo ? branchKey(defaultTo) : '');
  const activePage = page?.request === request ? page.value : null;
  const activeBody = body?.file === selected && activePage?.files.includes(selected!) ? body : null;

  useEffect(() => {
    if (!request || !repoRoot) {
      setLoading(false); setError(''); setBodyError(''); setSelected(null); setBody(null); setPage(null);
      return;
    }
    let cancelled = false;
    setLoading(true); setError(''); setBodyError(''); setSelected(null); setBody(null);
    const current = () => !cancelled && useGitStore.getState().repoRoot === repoRoot && useVaultStore.getState().vault === vault;
    void gitCompareFiles(repoRoot, request.comparison.from.oid, request.comparison.to.oid, request.skip, request.focusPath)
      .then((value) => {
        if (!current()) return;
        setPage({ request, value }); setSelected(value.files[0] ?? null); setLoading(false);
      }, (reason: unknown) => { if (current()) { setError(String(reason)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [repoRoot, request, vault]);

  useEffect(() => {
    if (!selected || !repoRoot || !request || !activePage?.files.includes(selected)) return;
    const controller = new AbortController();
    setBody(null); setBodyError('');
    const current = () => !controller.signal.aborted && useGitStore.getState().repoRoot === repoRoot && useVaultStore.getState().vault === vault;
    void (async () => {
      // Sequential reads keep native and renderer memory admission bounded for large files.
      const oldText = comparisonDisplayText(await gitCompareText(repoRoot, selected.old, controller.signal));
      const newText = comparisonDisplayText(await gitCompareText(repoRoot, selected.new, controller.signal));
      if (!current()) return;
      const comparison = await compareBranchText(oldText, newText, controller.signal);
      if (current()) setBody({ file: selected, oldText, newText, comparison, snippet: request.snippet });
    })().catch((reason: unknown) => { if (current()) setBodyError(String(reason)); });
    return () => controller.abort();
  }, [selected, repoRoot, request, vault, activePage]);

  const start = () => {
    const from = branches.find((b) => branchKey(b) === fromName);
    const to = branches.find((b) => branchKey(b) === toName);
    if (!from?.target || !to?.target) { setMessage('请选择已有提交的两个分支。'); return; }
    const pair = { from: { name: from.name, oid: from.target }, to: { name: to.name, oid: to.target } };
    setMessage(''); setRequest({ comparison: pair, skip: 0, focusPath: null, snippet: '' });
  };
  const locateCurrent = () => {
    if (!repoRoot || !request) return;
    const current = currentComparisonDocument(repoRoot);
    if (!current) { setMessage('当前文档不在此仓库内，无法定位到分支版本。'); return; }
    setMessage(''); setRequest({ comparison: request.comparison, skip: 0, focusPath: current.path, snippet: current.snippet });
  };

  if (!repoRoot) return <p className="p-3">当前工作区不是 Git 仓库。</p>;
  return <div className="flex min-h-0 flex-1 flex-col text-[var(--text-normal)]">
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--background-modifier-border)] p-2 text-[12px]">
      <label>基线分支 <select aria-label="基线分支" value={fromName} onChange={(event) => { setFromChoice(event.target.value); setRequest(null); }} className={buttonClass}>
        {branches.map((branch) => <option key={branchKey(branch)} value={branchKey(branch)}>{branch.name}{branch.isRemote ? '（远程）' : ''}</option>)}
      </select></label>
      <label>目标分支 <select aria-label="目标分支" value={toName} onChange={(event) => { setToChoice(event.target.value); setRequest(null); }} className={buttonClass}>
        {branches.map((branch) => <option key={branchKey(branch)} value={branchKey(branch)}>{branch.name}{branch.isRemote ? '（远程）' : ''}</option>)}
      </select></label>
      <button className={buttonClass} disabled={!fromName || !toName} onClick={() => start()}>比较完整正文</button>
      <button className={buttonClass} disabled={!request} onClick={() => {
        const pair = request!.comparison;
        setFromChoice(toName); setToChoice(fromName);
        setRequest({ comparison: { from: pair.to, to: pair.from }, skip: 0, focusPath: request!.focusPath, snippet: request!.snippet });
      }}>反向比较</button>
      <button className={buttonClass} disabled={!request} onClick={locateCurrent}>定位当前文档</button>
      {request?.focusPath ? <button className={buttonClass} onClick={() => setRequest({ ...request, skip: 0, focusPath: null, snippet: '' })}>全部变更</button> : null}
    </div>
    {request ? <p className="shrink-0 px-3 py-1 text-[12px] text-[var(--text-muted)]">
      {request.comparison.from.name} · {request.comparison.from.oid.slice(0, 10)} → {request.comparison.to.name} · {request.comparison.to.oid.slice(0, 10)} · 已固定提交；重新比较可更新。
    </p> : <p className="p-3 text-[13px]">选择两个分支查看完整正文；编辑文档保留在原标签页。</p>}
    {message ? <p role="status" className="px-3 py-1 text-[12px]">{message}</p> : null}
    {loading && request ? <p role="status" className="p-3">正在读取比较文件清单…</p> : null}
    {error && request ? <p role="alert" className="p-3">{error}</p> : null}
    {activePage && !loading ? activePage.total === 0 ? <p role="status" className="p-3">{request?.focusPath ? '当前文档在两个提交中均不存在。' : '两个分支没有文件差异。'}</p> :
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--background-modifier-border)]">
          <p className="p-2 text-[12px]">共 {activePage.total} 个文件 · 本页 {activePage.files.length} 个</p>
          <div className="min-h-0 flex-1 overflow-auto">
            {activePage.files.map((file) => <button key={`${file.old?.path}\0${file.new?.path}`} className={`block w-full break-all px-3 py-2 text-left text-[12px] ${selected === file ? 'bg-[var(--background-modifier-active)]' : 'hover:bg-[var(--background-modifier-hover)]'}`}
              aria-pressed={selected === file} onClick={() => setSelected(file)}>
              <span>{STATUS[file.status]} · {file.new?.path ?? file.old?.path}</span>
              {file.status === 'renamed' ? <span className="block text-[var(--text-muted)]">原名：{file.old?.path}</span> : null}
            </button>)}
          </div>
          <div className="flex gap-2 p-2">
            <button className={buttonClass} disabled={!request || request.skip === 0} onClick={() => request && setRequest({ ...request, skip: Math.max(0, request.skip - 100) })}>上一页</button>
            <button className={buttonClass} disabled={activePage.next === null} onClick={() => request && activePage.next !== null && setRequest({ ...request, skip: activePage.next })}>下一页</button>
          </div>
          <p className="px-2 pb-2 text-[11px] text-[var(--text-muted)]">内容不变的改名合并显示；改名同时编辑按新增/删除保留完整两侧。</p>
        </aside>
        {bodyError ? <p role="alert" className="p-3">{bodyError} <button className={buttonClass} onClick={() => request && setRequest({ ...request })}>重试</button></p> : activeBody ?
          <BodyView key={`${request?.comparison.from.oid}:${request?.comparison.to.oid}:${selected?.old?.path}:${selected?.new?.path}`} body={activeBody} /> : <p role="status" className="p-3">正在读取两侧完整正文…</p>}
      </div> : null}
  </div>;
}
