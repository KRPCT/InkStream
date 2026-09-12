import { useEffect, useRef, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { useGitCloneStore } from '../../stores/useGitCloneStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { cancelCloneRepository, cloneDestination, cloneInputError, configureCloneRemote, dismissCloneDialog, openClonedRepository, selectCloneParent, setCloneUrl, startCloneRepository } from '../../editor/gitCloneActions';
import type { GitRemoteMode } from '../../types/settings';

const REMOTE: Record<GitRemoteMode, string> = { local: '仅本地', ssh: 'SSH', oauth: 'GitHub 登录（github.com）', custom: '自定义服务器' };
const INPUT = 'w-full rounded border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1.5 text-[13px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)] disabled:opacity-60';
const BUTTON = 'rounded border border-[var(--background-modifier-border)] px-3 py-1.5 text-[13px] hover:bg-[var(--background-modifier-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-default disabled:opacity-50';

export default function GitCloneDialog() {
  const state = useGitCloneStore();
  const mode = useSettingsStore((s) => s.gitRemoteMode);
  const url = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state.open) return;
    const previous = document.activeElement as HTMLElement | null;
    url.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [state.open]);
  if (!state.open) return null;
  const busy = ['cloning', 'cancelling', 'opening'].includes(state.phase);
  const finished = state.phase === 'cloned' || state.phase === 'opening';
  const inputError = cloneInputError();
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); dismissCloneDialog(); }
    if (event.key === 'Tab') {
      const controls = panel.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="presentation" onMouseDown={dismissCloneDialog}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label="克隆仓库" onKeyDown={onKeyDown} onMouseDown={(event) => event.stopPropagation()} className="max-h-[85vh] w-[560px] max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-5 text-[var(--text-normal)] [box-shadow:var(--shadow-popup)]">
        <div className="flex items-center justify-between"><h2 className="text-[16px] font-semibold">克隆仓库</h2><button type="button" aria-label="关闭克隆对话框" disabled={state.phase === 'opening' || state.phase === 'cancelling'} onClick={dismissCloneDialog} className="rounded p-1 hover:bg-[var(--background-modifier-hover)]"><X size={16} /></button></div>
        <p className="mt-2 text-[12px] text-[var(--text-muted)]">选择父目录与新目录名称；已有同名目录时不会开始克隆。</p>
        <div className="mt-3 flex items-center justify-between text-[12px]"><span>连接方式：{REMOTE[mode]}</span><button type="button" disabled={busy} onClick={configureCloneRemote} className="underline underline-offset-2">更改远程方式</button></div>
        <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); if (!busy && !finished) void startCloneRepository(); }}>
          <label className="block text-[12px]">仓库 URL<input ref={url} type="text" autoComplete="off" spellCheck={false} disabled={busy || finished} value={state.url} onChange={(event) => setCloneUrl(event.target.value)} placeholder="git@github.com:owner/repository.git" className={`${INPUT} mt-1`} /></label>
          <label className="block text-[12px]">目标父目录<span className="mt-1 flex gap-2"><input type="text" readOnly value={state.parent} disabled={busy || finished} className={INPUT} /><button type="button" disabled={busy || finished} onClick={() => void selectCloneParent()} className={`${BUTTON} shrink-0`}>选择目录</button></span></label>
          <label className="block text-[12px]">新目录名称<input type="text" autoComplete="off" disabled={busy || finished} value={state.folder} onChange={(event) => useGitCloneStore.setState({ folder: event.target.value, error: null })} className={`${INPUT} mt-1`} /></label>
          {state.parent && state.folder ? <p className="break-all text-[12px] text-[var(--text-muted)]">目标：{cloneDestination(state.parent, state.folder)}</p> : null}
          {state.phase === 'cloning' ? <p role="status">正在克隆…</p> : null}
          {state.phase === 'cancelling' ? <p role="status">正在停止克隆，等待任务退出…</p> : null}
          {state.phase === 'cancelled' ? <p role="status">克隆已取消，可以重试。</p> : null}
          {finished ? <p role="status">{state.phase === 'opening' ? '正在打开工作区…' : '仓库克隆完成。选择打开后才会切换工作区。'}</p> : null}
          {state.progress.length > 0 ? <div role="log" aria-label="克隆进度" aria-live="polite" className="max-h-40 overflow-auto rounded bg-[var(--background-secondary)] p-2 font-mono text-[11px]">{state.progress.map((line, index) => <p key={index} className="break-all">{line}</p>)}</div> : null}
          {state.error ? <p role="alert" className="whitespace-pre-wrap break-all text-[12px] text-[var(--color-error)]">{state.error}</p> : null}
          {!busy && !finished && inputError ? <p className="text-[12px] text-[var(--text-muted)]">{inputError}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            {state.phase === 'cloning' || state.phase === 'cancelling' ? <button type="button" disabled={state.phase === 'cancelling'} onClick={() => void cancelCloneRepository()} className={BUTTON}>取消克隆</button> : <button type="button" disabled={state.phase === 'opening'} onClick={dismissCloneDialog} className={BUTTON}>关闭</button>}
            {finished ? <button type="button" disabled={state.phase === 'opening'} onClick={() => void openClonedRepository()} className={BUTTON}>打开工作区</button> : <button type="submit" disabled={busy || !!inputError} className={BUTTON}>{state.phase === 'failed' || state.phase === 'cancelled' ? '重试' : '开始克隆'}</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
