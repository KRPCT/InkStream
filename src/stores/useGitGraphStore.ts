import { create } from 'zustand';
import { gitDiff, gitLog, gitRefs } from '../ipc/git';
import type { CommitInfo, FileDiff, GitRef } from '../types/git';

/**
 * git-graph 视图状态（Phase 6 GIT-02/05）。commits/refs 仓库级（不随当前文档变）；
 * 三级选区 selectedOid → commitFiles（该 commit vs 首父的结构化 diff，既是文件列表也是 hunks 源）→ selectedFile。
 * 真相源纪律同其它 store：只持可序列化数据。repoRoot 内化，组件调 selectCommit 无需层层传递。
 */

/** 一次加载的最大提交数（千级足够；W5 接触底分页 append）。 */
const LOG_LIMIT = 500;

function pathOf(f: FileDiff): string {
  return f.newPath ?? f.oldPath ?? '';
}

interface GitGraphState {
  repoRoot: string | null;
  commits: CommitInfo[];
  refs: GitRef[];
  loading: boolean;
  selectedOid: string | null;
  /** 选中 commit 的 diff（vs 首父）：文件列表 + 各文件 hunks 一次取齐。 */
  commitFiles: FileDiff[];
  filesLoading: boolean;
  selectedFile: string | null;
  loadLog: (repoRoot: string) => Promise<void>;
  selectCommit: (oid: string) => void;
  selectFile: (path: string) => void;
}

export const useGitGraphStore = create<GitGraphState>((set, get) => ({
  repoRoot: null,
  commits: [],
  refs: [],
  loading: false,
  selectedOid: null,
  commitFiles: [],
  filesLoading: false,
  selectedFile: null,

  loadLog: async (repoRoot) => {
    set({ repoRoot, loading: true });
    try {
      const [commits, refs] = await Promise.all([gitLog(repoRoot, 0, LOG_LIMIT), gitRefs(repoRoot)]);
      if (get().repoRoot !== repoRoot) return; // 防竞态：加载期间切了仓库
      set({ commits, refs, loading: false });
      if (commits.length > 0) get().selectCommit(commits[0].oid); // 默认选最新
    } catch {
      if (get().repoRoot === repoRoot) set({ commits: [], refs: [], loading: false });
    }
  },

  selectCommit: (oid) => {
    const repoRoot = get().repoRoot;
    if (!repoRoot) return;
    set({ selectedOid: oid, commitFiles: [], selectedFile: null, filesLoading: true });
    void gitDiff(repoRoot, { commit: { oid } })
      .then((files) => {
        if (get().selectedOid !== oid) return; // 防竞态：期间又点了别的
        set({
          commitFiles: files,
          filesLoading: false,
          selectedFile: files.length > 0 ? pathOf(files[0]) : null,
        });
      })
      .catch(() => {
        if (get().selectedOid === oid) set({ filesLoading: false });
      });
  },

  selectFile: (selectedFile) => set({ selectedFile }),
}));
