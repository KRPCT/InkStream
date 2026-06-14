import { create } from 'zustand';
import { gitBranchList, gitStatus } from '../ipc/git';
import type { BranchInfo, GitStatus } from '../types/git';

/**
 * git 仓库状态层（Phase 6 GIT-01）。仓库根来自 VaultInfo.repoRoot（非 git 工作区为 null）。
 *
 * 真相源纪律（同 useVaultStore）：只持可序列化的 git 元数据，EditorView 等绝不进此 store。
 * 非 React 模块（vaultFlow / externalChange）经 getState() 调用。W2 git-graph 复用本 store 的
 * refresh + 扩展 commits/diff 选区。
 */

/** 外部变更去抖窗口：burst（多文件保存/拉取）合并成一次 status+branch 刷新。 */
const REFRESH_DEBOUNCE_MS = 300;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

interface GitState {
  /** 当前仓库根（来自 VaultInfo.repoRoot）；null = 非 git 工作区（指示器隐藏）。 */
  repoRoot: string | null;
  status: GitStatus | null;
  branches: BranchInfo[];
  loading: boolean;
  /** 设仓库根并立即刷新（vault 打开/切换时调；null 清空）。 */
  setRepoRoot: (root: string | null) => void;
  /** 立即拉 status + branches（操作后 / setRepoRoot 内调用）。 */
  refresh: () => Promise<void>;
  /** 去抖刷新（watcher 变更驱动，合并 burst）。 */
  scheduleRefresh: () => void;
}

export const useGitStore = create<GitState>((set, get) => ({
  repoRoot: null,
  status: null,
  branches: [],
  loading: false,
  setRepoRoot: (root) => {
    set({ repoRoot: root, status: null, branches: [] });
    void get().refresh();
  },
  refresh: async () => {
    const root = get().repoRoot;
    if (!root) {
      set({ status: null, branches: [] });
      return;
    }
    set({ loading: true });
    try {
      const [status, branches] = await Promise.all([gitStatus(root), gitBranchList(root)]);
      // 防竞态：异步期间 repoRoot 若已切换，丢弃这次结果（陈旧仓库数据不上屏）。
      if (get().repoRoot !== root) return;
      set({ status, branches, loading: false });
    } catch {
      // 非 git / 读失败：保持空，不抛 UI（与 GitGuidanceBar 的「非 git→引导 init」协同）。
      if (get().repoRoot === root) set({ loading: false });
    }
  },
  scheduleRefresh: () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void useGitStore.getState().refresh();
    }, REFRESH_DEBOUNCE_MS);
  },
}));
