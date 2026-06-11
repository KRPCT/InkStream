import { create } from 'zustand';

/** 引导态变体（D-05/D-06）。 */
export type GitGuidance =
  | { kind: 'none' }
  /** D-05：非 git 仓库，引导 git init（可跳过）。 */
  | { kind: 'init'; vaultRoot: string }
  /** D-06：打开的是 git 仓库子目录，提示「打开仓库根 / 仅此文件夹」。 */
  | { kind: 'subdir'; vaultRoot: string; repoRoot: string };

interface GitGuidanceState {
  guidance: GitGuidance;
  showInitGuidance: (vaultRoot: string) => void;
  showSubdirChoice: (vaultRoot: string, repoRoot: string) => void;
  dismiss: () => void;
}

/**
 * vault 语义引导态（D-05/D-06/D-07）。
 *
 * 非 git 工作区与 git 子目录的引导提示由此 store 驱动。git 功能本阶段置灰至 Phase 6，
 * 此处仅落地「引导态 + 可跳过」语义，实际 git init / 仓库根切换的执行留 Phase 6。
 * 非 React 模块（vaultFlow）经 getState() 调用（既定纪律）。
 */
export const useGitGuidanceStore = create<GitGuidanceState>((set) => ({
  guidance: { kind: 'none' },
  showInitGuidance: (vaultRoot) => set({ guidance: { kind: 'init', vaultRoot } }),
  showSubdirChoice: (vaultRoot, repoRoot) => set({ guidance: { kind: 'subdir', vaultRoot, repoRoot } }),
  dismiss: () => set({ guidance: { kind: 'none' } }),
}));
