import { GitBranch } from 'lucide-react';
import { switchVault } from '../../editor/vaultFlow';
import { useGitGuidanceStore } from '../../stores/useGitGuidanceStore';

/**
 * vault 语义引导提示条（D-05/D-06）。
 *
 * - 非 git 工作区（init）：「这个文件夹还不是 git 仓库...」+「初始化 git（置灰至 Phase 6）/ 以后再说」。
 * - git 子目录（subdir）：「打开仓库根 / 仅此文件夹」。
 *
 * git init 的实际执行留 Phase 6（git 功能置灰），本阶段仅落地引导 UI 与可跳过语义。
 */
export default function GitGuidanceBar() {
  const guidance = useGitGuidanceStore((s) => s.guidance);
  const dismiss = useGitGuidanceStore((s) => s.dismiss);

  if (guidance.kind === 'none') return null;

  return (
    <div className="flex items-center gap-2 border-b border-[var(--background-modifier-border)] bg-[var(--background-secondary-alt)] px-3 py-2">
      <GitBranch size={14} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
      {guidance.kind === 'init' ? (
        <>
          <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-[var(--text-muted)]">
            这个文件夹还不是 git 仓库，版本管理功能将在后续版本启用。
          </span>
          <button
            type="button"
            disabled
            title="git 功能将在 Phase 6 启用"
            className="shrink-0 cursor-not-allowed whitespace-nowrap rounded-[4px] px-2 py-1 text-[12px] text-[var(--text-faint)]"
          >
            初始化 git
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 whitespace-nowrap rounded-[4px] px-2 py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
          >
            以后再说
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[12px] leading-snug text-[var(--text-muted)]">
            这个文件夹在一个 git 仓库内，你想打开仓库根还是仅此文件夹？
          </span>
          <button
            type="button"
            onClick={() => {
              const root = guidance.repoRoot;
              dismiss();
              void switchVault(root);
            }}
            className="shrink-0 whitespace-nowrap rounded-[4px] px-2 py-1 text-[12px] font-semibold text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
          >
            打开仓库根
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 whitespace-nowrap rounded-[4px] px-2 py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)]"
          >
            仅此文件夹
          </button>
        </>
      )}
    </div>
  );
}
