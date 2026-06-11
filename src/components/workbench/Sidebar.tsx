import { FolderOpen } from 'lucide-react';
import EmptyState from '../common/EmptyState';
import { requestOpenFolder } from '../../editor/vaultFlow';
import { useVaultStore } from '../../stores/useVaultStore';
import FileTree from './FileTree';

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

/**
 * Sidebar：无 vault → 「未打开工作区」空态 + 打开文件夹按钮（最近列表槽位属 02-03）；
 * 有 vault → 头部条 + FileTree。1px 分隔线由 Separator 绘制。
 */
export default function Sidebar() {
  const vault = useVaultStore((s) => s.vault);

  if (!vault) {
    return (
      <div className="h-full bg-[var(--background-secondary)]">
        <EmptyState
          icon={FolderOpen}
          heading="未打开工作区"
          body="打开一个文件夹作为工作区，开始写作。"
          action={<OpenFolderButton />}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--background-secondary)]">
      <div className="flex h-8 items-center border-b border-[var(--background-modifier-border)] px-2">
        <span className="truncate text-[13px] text-[var(--text-normal)]">{vault.name}</span>
      </div>
      <div className="min-h-0 flex-1">
        <FileTree />
      </div>
    </div>
  );
}
