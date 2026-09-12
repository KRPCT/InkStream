import { FilePlus, FolderOpen, FolderPlus, ListCollapse, RefreshCw, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import EmptyState from '../common/EmptyState';
import { requestOpenFolder } from '../../editor/vaultFlow';
import { refreshTree } from '../../editor/fileTreeData';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useProjectStore } from '../../stores/useProjectStore';
import FileTree from './FileTree';
import GitGuidanceBar from './GitGuidanceBar';
import RecentVaults from './RecentVaults';
import ChapterSceneTree from './ChapterSceneTree';
import SidebarGitPanel from './SidebarGitPanel';
import { SearchResults, SidebarSearch } from './SidebarSearch';
import ZoteroLibraryPanel from './ZoteroLibraryPanel';
import { collapseAllInTree, newFileInTree, newFolderInTree } from './fileTreeController';

/** 空态「打开文件夹」按钮（与 EditorArea 同构）。 */
function OpenFolderButton() {
  return (
    <button
      type="button"
      onClick={() => void requestOpenFolder()}
      className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[14px] font-semibold text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
    >
      打开文件夹
    </button>
  );
}

/** 头部操作图标（32px 命中区 16px 图标，UI-SPEC 几何）。 */
function HeaderAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-[4px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}

/**
 * Sidebar：无 vault → 「未打开工作区」空态 + 打开文件夹按钮（最近列表属 Task 3）；
 * 有 vault → 头部条（vault 名 + 操作图标组）+ FileTree。
 */
export default function Sidebar() {
  const vault = useVaultStore((s) => s.vault);
  const mode = useWorkbenchStore((s) => s.mode);
  const simpleMode = useSettingsStore((s) => s.simpleMode);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<'files' | 'library' | 'chapters' | 'git'>('files');
  const projectName = useProjectStore((state) => state.catalog.projects.find((project) => project.id === state.activeId && !project.removed)?.name);
  const shownSection = simpleMode || (section === 'library' && mode !== 'academic') || (section === 'chapters' && mode !== 'creative') ? 'files' : section;
  const searching = query.trim().length > 0;

  if (!vault) {
    return (
      <div className="project-sidebar h-full overflow-auto bg-[var(--background-secondary)]">
        <EmptyState
          icon={FolderOpen}
          heading="未打开工作区"
          body="打开一个文件夹作为工作区，开始写作。"
          action={
            <div className="flex flex-col items-center">
              <OpenFolderButton />
              <RecentVaults />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="project-sidebar flex h-full flex-col bg-[var(--background-secondary)]">
      <div className="project-navigation-heading"><span className="material-eyebrow">MANUSCRIPT</span><span title={vault.root}>{projectName ?? vault.name}</span></div>
      {!simpleMode ? <div className="project-navigation-tabs" aria-label="项目导航分类">
        <button type="button" aria-pressed={shownSection === 'files'} onClick={() => setSection('files')}>文稿</button>
        {mode === 'academic' ? <button type="button" aria-pressed={shownSection === 'library'} onClick={() => setSection('library')}>文献</button> : null}
        {mode === 'creative' ? <button type="button" aria-pressed={shownSection === 'chapters'} onClick={() => setSection('chapters')}>章节</button> : null}
        <button type="button" aria-pressed={shownSection === 'git'} onClick={() => setSection('git')}>版本</button>
      </div> : null}
      <div className="project-file-actions flex h-8 items-center gap-1 pr-1 pl-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-muted)]">文件与文件夹</span>
        <HeaderAction icon={FilePlus} label="新建文件" onClick={newFileInTree} />
        <HeaderAction icon={FolderPlus} label="新建文件夹" onClick={newFolderInTree} />
        <HeaderAction icon={ListCollapse} label="折叠全部" onClick={collapseAllInTree} />
        <HeaderAction icon={RefreshCw} label="刷新" onClick={() => void refreshTree()} />
      </div>
      {/* 简易模式隐藏搜索/git/学术/创作高级面板，仅留文件树 */}
      {!simpleMode && shownSection === 'files' ? <SidebarSearch query={query} onQueryChange={setQuery} /> : null}
      {/* 有查询 → 扁平递归结果列表（R4 §4.2）；清空 → 恢复受控折叠树 */}
      <div className="min-h-0 flex-1 overflow-auto" style={{ display: shownSection === 'files' ? undefined : 'none' }}>
        {!simpleMode && searching ? <SearchResults query={query} /> : <FileTree />}
      </div>
      {/* 簇①：侧栏简易源代码管理面板（git 仓库才显示，置底，可折叠） */}
      {shownSection === 'library' ? <div className="navigation-tool-body"><ZoteroLibraryPanel /></div> : null}
      {shownSection === 'chapters' ? <div className="navigation-tool-body"><ChapterSceneTree /></div> : null}
      {shownSection === 'git' ? <div className="navigation-tool-body"><GitGuidanceBar /><SidebarGitPanel /></div> : null}
    </div>
  );
}
