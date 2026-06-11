import { FilePlus, FolderOpen, FolderPlus, ListCollapse, RefreshCw, type LucideIcon } from 'lucide-react';
import EmptyState from '../common/EmptyState';
import { refreshTree, requestOpenFolder } from '../../editor/vaultFlow';
import { useVaultStore } from '../../stores/useVaultStore';
import FileTree from './FileTree';
import GitGuidanceBar from './GitGuidanceBar';
import RecentVaults from './RecentVaults';
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
      <GitGuidanceBar />
      <div className="min-h-0 flex-1">
        <FileTree />
      </div>
    </div>
  );
}
