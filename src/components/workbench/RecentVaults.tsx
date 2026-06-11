import { Clock } from 'lucide-react';
import { switchVault } from '../../editor/vaultFlow';
import { useVaultStore } from '../../stores/useVaultStore';

/** 取路径末段作显示名（vault 文件夹名）。 */
function baseName(path: string): string {
  const norm = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}

/**
 * 空态「最近打开」列表（D-07/UI-SPEC）：点击同窗重载该 vault（switchVault）。
 * 无最近项时不渲染（逐空态由上层 EmptyState 兜底）。
 */
export default function RecentVaults() {
  const recent = useVaultStore((s) => s.recentVaults);
  if (recent.length === 0) return null;

  return (
    <div className="mt-6 w-full max-w-[280px]">
      <p className="mb-2 px-2 text-[12px] font-semibold tracking-wide text-[var(--text-muted)]">最近打开</p>
      <ul className="flex flex-col">
        {recent.map((path) => (
          <li key={path}>
            <button
              type="button"
              onClick={() => void switchVault(path)}
              title={path}
              className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left hover:bg-[var(--background-modifier-hover)]"
            >
              <Clock size={14} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-normal)]">
                {baseName(path)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
