import { useEffect } from 'react';
import { NotebookTabs, RefreshCw } from 'lucide-react';
import { CODEX_TYPE_LABEL, refreshCodex } from '../../editor/codex';
import { openFileByPath } from '../../editor/fileOpenFlow';
import { useCodexStore } from '../../stores/useCodexStore';
import { useVaultStore } from '../../stores/useVaultStore';
import EmptyState from '../common/EmptyState';

/**
 * Codex 面板（CREA-02，RightPanel codex tab）：列 `Codex/` 文件夹下的角色/地点/设定条目，点击打开该条目文件。
 * 数据 useCodexStore（editor/codex 扫描）；挂载/换库时重扫，刷新按钮手动重扫（编辑条目后更新提及高亮）。
 */
export default function CodexPanel() {
  const entries = useCodexStore((s) => s.entries);
  const root = useVaultStore((s) => s.vault?.root ?? null);

  useEffect(() => {
    if (root) void refreshCodex(root);
  }, [root]);

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={NotebookTabs}
        heading="Codex 还是空的"
        body="在 Codex/ 文件夹放角色/地点/设定条目（frontmatter 写 type 与 name），编辑器中的提及会自动高亮。"
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--background-modifier-border)] px-3 text-[12px]">
        <span className="text-[var(--text-muted)]">Codex {entries.length}</span>
        <button
          type="button"
          title="重新扫描 Codex/"
          onClick={() => root && void refreshCodex(root)}
          className="ml-auto rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
        >
          <RefreshCw size={13} aria-hidden="true" />
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1">
        {entries.map((e) => (
          <li key={e.path}>
            <button
              type="button"
              onClick={() => void openFileByPath(e.path)}
              title={e.summary || e.name}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-[13px] hover:bg-[var(--background-modifier-hover)]"
            >
              <span className="min-w-0 flex-1 truncate text-[var(--text-normal)]">{e.name}</span>
              <span className="shrink-0 rounded-full bg-[var(--background-modifier-active)] px-1.5 text-[11px] text-[var(--text-muted)]">
                {CODEX_TYPE_LABEL[e.type]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
