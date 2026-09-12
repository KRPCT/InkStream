import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { effectiveCentralView } from '../../stores/effectiveCentralView';
import AcademicToolbar from './AcademicToolbar';
import EditorArea from './EditorArea';
import SceneSummaryCard from './SceneSummaryCard';
import { flushSync } from 'react-dom';
import { insertCitekey } from '../../editor/academicActions';
import { newDraftDocument } from '../../editor/draftFlow';
import WorkspaceNavigation from './WorkspaceNavigation';
import ProjectOverview from './ProjectOverview';
import ProjectVersions from './ProjectVersions';
import ZoteroLibraryPanel from './ZoteroLibraryPanel';

/**
 * 中央区（editor-area 面板内容）：EditorArea **永不卸载**（display:none 切换保 CM 实例 / IME 锚定 / 光标，
 * 承五插槽零卸载铁律）。Academic 模式在编辑器上方挂学术工具栏（ACAD-02）。
 * 日常目的地保留侧栏。高级 GitGraphView 仍由 WorkbenchLayout 提供全宽工具空间。
 */
export default function CentralArea() {
  const requestedView = useWorkbenchStore((s) => s.centralView);
  const mode = useWorkbenchStore((s) => s.mode);
  const simpleMode = useSettingsStore((s) => s.simpleMode);
  const bookshelfEnabled = useSettingsStore((s) => s.bookshelfEnabled);
  const view = effectiveCentralView(requestedView, { simpleMode, bookshelfEnabled });
  return (
    <div className="workspace-main flex h-full flex-col">
      <WorkspaceNavigation />
      <div id="workspace-view-editor" role="tabpanel" aria-labelledby="workspace-tab-editor" className="min-h-0 flex-1 flex flex-col" hidden={view !== 'editor'} style={{ display: view === 'editor' ? undefined : 'none' }}>
      {mode === 'academic' ? <AcademicToolbar /> : null}
      {/* CREA-05：Creative 模式编辑器顶可折叠场景概要卡（无概要则不渲染） */}
      {mode === 'creative' ? <SceneSummaryCard /> : null}
      <div className="min-h-0 flex-1">
        <EditorArea />
      </div>
      </div>
      {view === 'projectOverview' ? <div id="workspace-view-projectOverview" role="tabpanel" aria-labelledby="workspace-tab-projectOverview" className="workspace-destination"><ProjectOverview onNewDocument={() => {
        flushSync(() => useWorkbenchStore.getState().setCentralView('editor'));
        newDraftDocument();
      }} /></div> : null}
      {view === 'references' ? <div id="workspace-view-references" role="tabpanel" aria-labelledby="workspace-tab-references" className="workspace-destination"><ZoteroLibraryPanel workspace onInsert={(citekey) => {
        flushSync(() => useWorkbenchStore.getState().setCentralView('editor'));
        insertCitekey(citekey);
      }} /></div> : null}
      {view === 'projectVersions' ? <div id="workspace-view-projectVersions" role="tabpanel" aria-labelledby="workspace-tab-projectVersions" className="workspace-destination"><ProjectVersions /></div> : null}
    </div>
  );
}
