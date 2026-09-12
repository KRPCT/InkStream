import { Archive, PanelLeft, PanelRight, Settings } from 'lucide-react';
import { execute } from '../../commands/registry';
import { useProjectStore } from '../../stores/useProjectStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';

export default function ProjectRail() {
  const catalog = useProjectStore((state) => state.catalog);
  const activeId = useProjectStore((state) => state.activeId);
  const archiveOpen = useProjectStore((state) => state.archiveOpen);
  const phase = useProjectStore((state) => state.phase);
  const project = catalog.projects.find((item) => item.id === activeId && !item.removed);
  const count = catalog.projects.filter((item) => !item.removed).length;
  return <nav className="project-rail" aria-label="项目与工作台">
    <span className="inkstream-mark" role="img" aria-label="InkStream 墨流">
      <svg width="28" height="32" viewBox="0 0 28 32" fill="none" aria-hidden="true"><path d="M5 6h8c7 0 10 4 10 8s-3 8-10 8H5" stroke="currentColor" strokeWidth="2" /><path d="M5 12h8c3 0 4 1 4 3s-1 3-4 3H5M5 27h12" stroke="currentColor" strokeWidth="2" /></svg>
    </span>
    <button type="button" className="project-rail-archive" aria-label="打开项目档案" title="项目档案 · Ctrl+Alt+P"
      aria-haspopup="dialog" aria-expanded={archiveOpen} onClick={() => void execute('project.archive')} disabled={phase !== 'idle'}>
      <span className="project-rail-spine" key={project?.id ?? 'loose'}><span>{project?.name ?? '独立草稿'}</span></span>
      <Archive size={17} aria-hidden="true" /><span className="project-rail-label">项目</span>
    </button>
    <span className="project-rail-count" title={`${count} 个本机项目`}>{String(count).padStart(2, '0')}</span>
    <div className="project-rail-actions">
      <button type="button" aria-label="展开或收起文件导航" title="文件导航 · Ctrl+\\" disabled={phase !== 'idle' || archiveOpen} onClick={() => useWorkbenchStore.getState().toggleSidebar()}><PanelLeft size={17} /></button>
      <button type="button" aria-label="展开或收起工具面板" title="工具面板 · Ctrl+Alt+B" disabled={phase !== 'idle' || archiveOpen} onClick={() => useWorkbenchStore.getState().toggleRightPanel()}><PanelRight size={17} /></button>
      <button type="button" aria-label="打开设置" title="设置 · Ctrl+," disabled={phase !== 'idle' || archiveOpen} onClick={() => void execute('view.settings')}><Settings size={17} /></button>
    </div>
  </nav>;
}
