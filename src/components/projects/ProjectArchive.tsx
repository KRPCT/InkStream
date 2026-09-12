import { Archive, ArrowRight, FolderPlus, MoreHorizontal, Search, Star, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { addProjectDirectory, importProjectCover, openProject, recoverProjectBackup, relocateProject, removeProject, renameProject, retryProjectSnapshot, setProjectFavorite } from '../../projects/actions';
import { useProjectStore } from '../../stores/useProjectStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { getView } from '../../editor/viewHandle';
import type { ProjectRecord } from '../../types/projects';
import ProjectCover from './ProjectCover';

const PHASE = { idle: '', loading: '读取项目档案…', saving: '保存当前文稿与会话…', opening: '打开目标项目…', restoring: '恢复标签、光标与布局…' };
type RunAction = (action: () => unknown | Promise<unknown>) => Promise<void>;

function ProjectDetails({ project, busy, run }: { project: ProjectRecord; busy: boolean; run: RunAction }) {
  const [name, setName] = useState(project.name);
  return <aside className="project-details" aria-label={`${project.name} 项目资料`}>
    <span className="material-eyebrow">PROJECT RECORD</span>
    <ProjectCover key={project.cover} name={project.name} path={project.cover} large />
    <form onSubmit={(event) => { event.preventDefault(); void run(() => renameProject(project.id, name.trim())); }}>
      <label className="project-field-label" htmlFor="project-name">项目名称</label>
      <input id="project-name" value={name} maxLength={120} disabled={busy} onChange={(event) => setName(event.target.value)} />
      <button type="submit" className="material-button" disabled={busy || !name.trim() || name.trim() === project.name}>保存名称</button>
    </form>
    <span className="project-field-label">内容目录</span><p className="project-root-path">{project.root}</p>
    <div className="project-detail-actions">
      <button type="button" disabled={busy} onClick={() => void run(() => importProjectCover(project.id))}>更换封面</button>
      <button type="button" disabled={busy} onClick={() => void run(() => relocateProject(project.id))}>重新定位文件夹</button>
      <button type="button" disabled={busy} onClick={() => void run(() => recoverProjectBackup(project.id, 'session'))}>恢复上次会话备份</button>
      <button type="button" disabled={busy} onClick={() => void run(() => removeProject(project.id))}>移除项目档案</button>
    </div>
    <p className="project-detail-note">项目资料保存在本机。移除档案会保留内容文件夹。</p>
  </aside>;
}

function ArchiveContents() {
  const catalog = useProjectStore((state) => state.catalog);
  const activeId = useProjectStore((state) => state.activeId);
  const phase = useProjectStore((state) => state.phase);
  const ready = useProjectStore((state) => state.ready);
  const error = useProjectStore((state) => state.error);
  const snapshotError = useProjectStore((state) => state.snapshotError);
  const snapshotStatus = useProjectStore((state) => state.snapshotStatus);
  const setArchiveOpen = useProjectStore((state) => state.setArchiveOpen);
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const returnPreviousFocus = useRef(true);
  const busy = working || phase !== 'idle';
  const projects = catalog.projects.filter((project) => !project.removed).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.name.localeCompare(b.name));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const shown = projects.filter((project) => (!favorites || project.favorite) && (!normalizedQuery || `${project.name}\n${project.root}`.toLocaleLowerCase().includes(normalizedQuery)));
  const details = projects.find((project) => project.id === detailsId) ?? null;

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    search.current?.focus();
    return () => {
      mounted.current = false;
      if (returnPreviousFocus.current && previous?.isConnected) previous.focus();
      else if (!returnPreviousFocus.current && useEditorStore.getState().activePath) getView()?.focus();
    };
  }, []);

  const run: RunAction = async (action) => {
    if (inFlight.current || useProjectStore.getState().phase !== 'idle') return;
    inFlight.current = true;
    setWorking(true); setActionError(null);
    try { await action(); }
    catch (reason) { if (mounted.current) setActionError(reason instanceof Error ? reason.message : String(reason)); }
    finally { inFlight.current = false; if (mounted.current) setWorking(false); }
  };
  const enter = (id: string | null) => run(async () => {
    if (await openProject(id)) {
      returnPreviousFocus.current = !useEditorStore.getState().activePath;
      setArchiveOpen(false);
    }
  });
  const close = () => { if (!busy) setArchiveOpen(false); };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') {
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])];
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.target instanceof HTMLElement && event.target.hasAttribute('data-project-open') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[data-project-open]') ?? [])];
      const index = items.indexOf(event.target as HTMLButtonElement);
      event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  };

  return <div className="project-archive-overlay">
    <button className="project-archive-backdrop" type="button" tabIndex={-1} aria-label="关闭项目档案遮罩" onClick={close} disabled={busy} />
    <section ref={panel} role="dialog" aria-modal="true" aria-labelledby="project-archive-title" tabIndex={-1} onKeyDown={onKeyDown}
      className={`project-archive-panel${details ? ' has-details' : ''}${phase !== 'idle' ? ' is-switching' : ''}`}>
      <div className="archive-depth" aria-hidden="true" />
      <header className="project-archive-heading">
        <div><span className="material-eyebrow">LOCAL COLLECTION</span><h2 id="project-archive-title">项目档案</h2></div>
        <button type="button" className="material-icon-button" aria-label="关闭项目档案" disabled={busy} onClick={close}><X size={19} /></button>
      </header>
      <div className="project-archive-body">
        <div className="project-archive-main">
          <label className="project-search"><Search size={16} aria-hidden="true" /><input ref={search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称或目录" aria-label="搜索项目档案" /></label>
          <div className="project-archive-controls">
            <div className="material-segment"><button type="button" aria-pressed={!favorites} onClick={() => setFavorites(false)}>全部 <span>{projects.length}</span></button><button type="button" aria-pressed={favorites} onClick={() => setFavorites(true)}>收藏</button></div>
            <button type="button" className="material-icon-button" title="添加文件夹为项目" aria-label="添加项目文件夹" disabled={busy} onClick={() => void run(async () => { const added = await addProjectDirectory(); if (added && mounted.current) setDetailsId(added.id); })}><FolderPlus size={18} /></button>
          </div>
          {(error || actionError) ? <div role="alert" className="project-error"><p>{actionError ?? error}</p>{!ready ? <button type="button" disabled={busy} onClick={() => void run(() => recoverProjectBackup(null, 'catalog'))}>恢复项目档案备份</button> : null}</div> : null}
          {snapshotStatus === 'error' ? <div role="alert" className="project-error"><p>{snapshotError ?? '会话暂存失败，当前文稿已保留。'}</p><button type="button" disabled={busy} onClick={() => void run(retryProjectSnapshot)}>重试保存会话</button></div> : null}
          {phase !== 'idle' ? <div className="project-phase" role="status"><span className="project-phase-dot" />{PHASE[phase]}</div> : null}
          {!ready && !error && phase === 'idle' ? <div className="project-phase" role="status">正在读取项目档案…</div> : null}
          <ul className="project-archive-list" aria-label="项目档案列表">
            {shown.map((project) => <li key={project.id} className="project-card" data-current={project.id === activeId} data-selected={detailsId === project.id}>
              <button type="button" data-project-open={project.id} className="project-card-main" aria-label={`打开项目 ${project.name}`} disabled={busy} onClick={() => void enter(project.id)}>
                <ProjectCover key={project.cover} name={project.name} path={project.cover} />
                <span className="project-card-text"><strong>{project.name}</strong><span title={project.root}>{project.root}</span>{project.id === activeId ? <em>当前项目</em> : null}</span>
                <ArrowRight size={16} className="project-card-arrow" aria-hidden="true" />
              </button>
              <div className="project-card-actions">
                <button type="button" className="material-icon-button" aria-label={`${project.favorite ? '取消收藏' : '收藏'} ${project.name}`} aria-pressed={project.favorite} disabled={busy} onClick={() => void run(() => setProjectFavorite(project.id, !project.favorite))}><Star size={15} fill={project.favorite ? 'currentColor' : 'none'} /></button>
                <button type="button" className="material-icon-button" aria-label={`管理项目 ${project.name}`} aria-expanded={detailsId === project.id} onClick={() => setDetailsId(detailsId === project.id ? null : project.id)}><MoreHorizontal size={17} /></button>
              </div>
            </li>)}
          </ul>
          {ready && shown.length === 0 ? <div className="project-archive-empty"><Archive size={28} strokeWidth={1.2} /><h3>{projects.length ? '没有匹配的项目' : '为下一段写作，留一个位置'}</h3><p>{projects.length ? '试试其他名称或目录，或查看全部项目。' : '添加一个内容文件夹。文稿仍在原处，项目资料留在本机。'}</p></div> : null}
          <footer className="project-archive-footer"><button type="button" disabled={busy} onClick={() => void enter(null)}>独立草稿 <ArrowRight size={14} /></button><span>不需要 Git 仓库</span></footer>
        </div>
        {details ? <ProjectDetails key={details.id} project={details} busy={busy} run={run} /> : null}
      </div>
    </section>
  </div>;
}

export default function ProjectArchive() {
  return useProjectStore((state) => state.archiveOpen) ? <ArchiveContents /> : null;
}
