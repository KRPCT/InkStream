import { FileText, ArrowRight, Plus } from 'lucide-react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import ProjectCover from '../projects/ProjectCover';
import { stripVerbatim } from '../../editor/pathUtil';

export default function ProjectOverview({ onNewDocument }: { onNewDocument: () => void }) {
  const project = useProjectStore((s) => s.catalog.projects.find((p) => p.id === s.activeId && !p.removed));
  const vault = useVaultStore((s) => s.vault);
  const files = useVaultStore((s) => s.files);
  const tabs = useEditorStore((s) => s.tabs);
  const activePath = useEditorStore((s) => s.activePath);
  const dirty = useEditorStore((s) => s.dirty);
  const active = tabs.find((tab) => tab.path === activePath);
  const name = project?.name ?? vault?.name ?? '独立草稿';
  const root = project?.root ?? vault?.root;
  return <section className="project-overview">
    <header><ProjectCover name={name} path={project?.cover ?? null} large /><div><span className="workspace-caption">项目概览</span><h1>{name}</h1><p>{root ? stripVerbatim(root) : '随时写下想法，保存时再选择位置。'}</p></div></header>
    <dl className="project-overview-metrics">
      <div><dt>项目文件</dt><dd>{files.length}</dd></div>
      <div><dt>已开文稿</dt><dd>{tabs.length}</dd></div>
      <div><dt>待保存</dt><dd>{tabs.filter((tab) => dirty[tab.path]).length}</dd></div>
    </dl>
    <h2>继续写作</h2>
    {active ? <button type="button" className="overview-continue" onClick={() => useWorkbenchStore.getState().setCentralView('editor')}><FileText size={20} /><span><strong>{active.name}</strong><small>{dirty[active.path] ? '有待保存的修改' : '返回上次的光标位置'}</small></span><ArrowRight size={18} /></button> : <p>还没有打开文稿，从一份新草稿开始。</p>}
    <button type="button" className="overview-new" onClick={onNewDocument}><Plus size={17} />新建文稿</button>
  </section>;
}
