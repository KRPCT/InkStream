import { FilePlus, FolderOpen, FolderPlus, ListCollapse, RefreshCw, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import EmptyState from '../common/EmptyState';
import { requestOpenFolder } from '../../editor/vaultFlow';
import { refreshTree } from '../../editor/fileTreeData';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import FileTree from './FileTree';
import GitGuidanceBar from './GitGuidanceBar';
import RecentVaults from './RecentVaults';
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
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;

  if (!vault) {
    return (
      <div className="h-full overflow-auto bg-[var(--background-secondary)]">
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
    <div className="flex h-full flex-col bg-[var(--background-secondary)]">
      <div className="flex h-8 items-center gap-1 border-b border-[var(--background-modifier-border)] pr-1 pl-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-normal)]">{vault.name}</span>
        <HeaderAction icon={FilePlus} label="新建文件" onClick={newFileInTree} />
        <HeaderAction icon={FolderPlus} label="新建文件夹" onClick={newFolderInTree} />
        <HeaderAction icon={ListCollapse} label="折叠全部" onClick={collapseAllInTree} />
        <HeaderAction icon={RefreshCw} label="刷新" onClick={() => void refreshTree()} />
      </div>
      <SidebarSearch query={query} onQueryChange={setQuery} />
      <GitGuidanceBar />
      {/* ACAD-01：Academic 模式 Sidebar 上半 Zotero 文献库（其余模式不显），下半为文件树 */}
      {mode === 'academic' ? <ZoteroLibraryPanel /> : null}
      {/* 有查询 → 扁平递归结果列表（R4 §4.2）；清空 → 恢复受控折叠树 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {searching ? <SearchResults query={query} /> : <FileTree />}
      </div>
      {/* 簇①：侧栏简易源代码管理面板（git 仓库才显示，置底，可折叠） */}
      <SidebarGitPanel />
    </div>
  );
}
