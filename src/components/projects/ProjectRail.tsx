import { Archive, PanelLeft, PanelRight, Settings } from 'lucide-react';
import { execute } from '../../commands/registry';
import { useProjectStore } from '../../stores/useProjectStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { openProject } from '../../projects/actions';
import ProjectCover from './ProjectCover';

export default function ProjectRail() {
  const catalog = useProjectStore((state) => state.catalog);
  const activeId = useProjectStore((state) => state.activeId);
  const archiveOpen = useProjectStore((state) => state.archiveOpen);
  const phase = useProjectStore((state) => state.phase);
  const layout = useWorkbenchStore((state) => state.layouts[state.mode]);
  const projects = catalog.projects.filter((item) => !item.removed).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.lastOpenedAt - a.lastOpenedAt);
  return <nav className="project-rail" aria-label="项目与工作台">
    <img className="inkstream-mark" src="/inkstream-icon.svg" width="38" height="38" alt="InkStream 墨流" draggable={false} />
    <button type="button" className="project-rail-archive" aria-label="打开项目档案" title="项目档案 · Ctrl+Alt+P"
      aria-haspopup="dialog" aria-expanded={archiveOpen} onClick={() => void execute('project.archive')} disabled={phase !== 'idle'}>
      <Archive size={17} aria-hidden="true" /><span className="project-rail-label">项目档案</span>
    </button>
    <div className="project-rail-projects" aria-label="本机项目">
      {projects.map((project) => <button type="button" key={project.id} className="project-rail-project" aria-label={`打开项目：${project.name}`} aria-current={project.id === activeId ? 'true' : undefined}
        title={project.name} disabled={phase !== 'idle' || archiveOpen} onClick={() => { void openProject(project.id).then((opened) => { if (!opened) useProjectStore.getState().setArchiveOpen(true); }); }}>
        <ProjectCover name={project.name} path={project.cover} /><span>{project.name}</span>
      </button>)}
      {!projects.length ? <span className="project-rail-empty">独立草稿</span> : null}
    </div>
    <div className="project-rail-actions">
      <button type="button" aria-label="展开或收起文件导航" aria-pressed={!layout.sidebarCollapsed} title="文件导航 · Ctrl+\\" disabled={phase !== 'idle' || archiveOpen} onClick={() => useWorkbenchStore.getState().toggleSidebar()}><PanelLeft size={17} /></button>
      <button type="button" aria-label="展开或收起工具面板" aria-pressed={!layout.rightPanelCollapsed} title="工具面板 · Ctrl+Alt+B" disabled={phase !== 'idle' || archiveOpen} onClick={() => useWorkbenchStore.getState().toggleRightPanel()}><PanelRight size={17} /></button>
      <button type="button" aria-label="打开设置" title="设置 · Ctrl+," disabled={phase !== 'idle' || archiveOpen} onClick={() => void execute('view.settings')}><Settings size={17} /></button>
    </div>
  </nav>;
}
