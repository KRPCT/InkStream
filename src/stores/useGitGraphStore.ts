import { create } from 'zustand';
import { gitLog, gitRefs } from '../ipc/git';
import { gitCommitFiles } from '../ipc/gitCompare';
import { currentComparisonDocument } from '../editor/gitCompareActions';
import { githubPrDiffPage } from '../ipc/githubPage';
import { useGitStore } from './useGitStore';
import { useVaultStore } from './useVaultStore';
import type { GithubPrDiffPage } from '../types/githubPage';
import type { GitComparePage, GitComparison } from '../types/gitCompare';
import type { CommitInfo, FileDiff, GitRef, PullRequest } from '../types/git';

/**
 * git-graph 视图状态（Phase 6 GIT-02/05）。commits/refs 仓库级（不随当前文档变）；
 * 三级选区 selectedOid → commitFiles（该 commit vs 首父的结构化 diff，既是文件列表也是 hunks 源）→ selectedFile。
 * 真相源纪律同其它 store：只持可序列化数据。repoRoot 内化，组件调 selectCommit 无需层层传递。
 */

/** 一次加载的最大提交数（千级足够；W5 接触底分页 append）。 */
const LOG_LIMIT = 500;
let logGeneration = 0;
let diffGeneration = 0;

function pathOf(f: FileDiff): string {
  return f.newPath ?? f.oldPath ?? '';
}

interface GitGraphState {
  repoRoot: string | null;
  commits: CommitInfo[];
  refs: GitRef[];
  loading: boolean;
  selectedOid: string | null;
  /** Current commit page metadata; bodies are fetched separately through Raw channels. */
  commitFiles: FileDiff[];
  commitPage: GitComparePage | null;
  commitSkip: number;
  loadCommitPage: (skip: number, focusPath?: string | null) => void;
  filesLoading: boolean;
  selectedFile: string | null;
  /** 远程操作进行中的提示文案（W4，fetch/push/pull 期间显示；null=空闲）。 */
  remoteBusy: string | null;
  /** git-graph 左栏视图：提交图谱 / 分支管理 / 暂存记录 / Pull Requests / Issues。 */
  leftMode: 'graph' | 'branches' | 'compare' | 'stashes' | 'pr' | 'issues';
  setLeftMode: (mode: 'graph' | 'branches' | 'compare' | 'stashes' | 'pr' | 'issues') => void;
  /** 选中的 PR（leftMode==='pr' 时中栏显详情、右栏复用 commitFiles 显其文件 diff）；null=未选。 */
  selectedPr: PullRequest | null;
  selectedPrRepoRoot: string | null;
  prDiff: GithubPrDiffPage | null;
  prPage: number;
  filesError: string | null;
  comparisonStart: { comparison: GitComparison; path: string | null } | null;
  selectPr: (pr: PullRequest, sourceRepoRoot?: string) => void;
  loadPrPage: (page: number) => void;
  clearRepository: () => void;
  /** Find Widget 开关（W5）：提交搜索栏显隐。 */
  findOpen: boolean;
  setFindOpen: (open: boolean) => void;
  /** Filter Branches（W5）：选中的分支名（空 = 全部分支）；改变即重载 log。 */
  filterRefs: string[];
  setFilterRefs: (refs: string[]) => void;
  /** Repository Settings（W5）：加载提交数上限；改变即重载 log。 */
  graphLimit: number;
  setGraphLimit: (n: number) => void;
  /** Repository Settings（W5）：日期相对显示（'3天前'）vs 绝对（本地日期时间）。 */
  dateRelative: boolean;
  setDateRelative: (b: boolean) => void;
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
  selectedPr: null,
  selectedPrRepoRoot: null,
  prDiff: null,
  prPage: 1,
  filesError: null,
  comparisonStart: null,
  commitFiles: [],
  commitPage: null,
  commitSkip: 0,
  filesLoading: false,
  selectedFile: null,
  remoteBusy: null,
  leftMode: 'graph',
  setLeftMode: (mode) => {
    if (get().leftMode !== mode) diffGeneration++;
    set((s) =>
      s.leftMode === mode
        ? s
        : { leftMode: mode, selectedPr: null, selectedPrRepoRoot: null, selectedOid: null, prDiff: null, commitPage: null, commitSkip: 0, commitFiles: [], selectedFile: null, filesLoading: false, filesError: null },
    );
  },
  clearRepository: () => {
    logGeneration++; diffGeneration++;
    set({ repoRoot: null, commits: [], refs: [], loading: false, selectedPr: null, selectedPrRepoRoot: null,
      selectedOid: null, prDiff: null, commitPage: null, commitSkip: 0, commitFiles: [], selectedFile: null, filesLoading: false, filesError: null, comparisonStart: null });
  },
  findOpen: false,
  setFindOpen: (findOpen) => set({ findOpen }),
  filterRefs: [],
  setFilterRefs: (filterRefs) => {
    set({ filterRefs });
    const root = get().repoRoot;
    if (root) void get().loadLog(root);
  },
  graphLimit: LOG_LIMIT,
  setGraphLimit: (graphLimit) => {
    set({ graphLimit });
    const root = get().repoRoot;
    if (root) void get().loadLog(root);
  },
  dateRelative: false,
  setDateRelative: (dateRelative) => set({ dateRelative }),

  loadLog: async (repoRoot) => {
    const request = ++logGeneration;
    const vault = useVaultStore.getState().vault;
    if (get().repoRoot !== repoRoot) { diffGeneration++; set({ commits: [], refs: [], selectedPr: null, selectedPrRepoRoot: null, selectedOid: null, prDiff: null, commitFiles: [], selectedFile: null }); }
    const selectedGeneration = diffGeneration;
    set({ repoRoot, loading: true });
    try {
      const [commits, refs] = await Promise.all([
        gitLog(repoRoot, get().filterRefs, 0, get().graphLimit),
        gitRefs(repoRoot),
      ]);
      if (request !== logGeneration || get().repoRoot !== repoRoot || useGitStore.getState().repoRoot !== repoRoot || useVaultStore.getState().vault !== vault) return;
      set({ commits, refs, loading: false });
      if (commits.length > 0 && get().leftMode === 'graph' && selectedGeneration === diffGeneration
        && !commits.some((commit) => commit.oid === get().selectedOid)) get().selectCommit(commits[0].oid);
    } catch {
      if (request === logGeneration && get().repoRoot === repoRoot) set({ commits: [], refs: [], loading: false });
    }
  },

  selectCommit: (oid) => {
    diffGeneration++;
    set({ selectedOid: oid, selectedPr: null, selectedPrRepoRoot: null, prDiff: null, commitPage: null, commitFiles: [], selectedFile: null, filesError: null });
    get().loadCommitPage(0);
  },

  loadCommitPage: (skip, focusPath = null) => {
    const repoRoot = get().repoRoot;
    const oid = get().selectedOid;
    if (!repoRoot || !oid) return;
    const request = ++diffGeneration;
    const vault = useVaultStore.getState().vault;
    const current = () => request === diffGeneration && get().repoRoot === repoRoot && useGitStore.getState().repoRoot === repoRoot && useVaultStore.getState().vault === vault;
    set({ commitSkip: skip, commitPage: null, commitFiles: [], selectedFile: null, filesLoading: true, filesError: null });
    void gitCommitFiles(repoRoot, oid, skip, focusPath)
      .then((page) => {
        if (!current() || get().selectedOid !== oid) return;
        const active = currentComparisonDocument(repoRoot)?.path;
        const files: FileDiff[] = page.files.map((file) => ({ oldPath: file.old?.path ?? null, newPath: file.new?.path ?? null,
          status: file.status === 'unchanged' ? 'modified' : file.status, binary: false, hunks: [] }));
        set({
          commitPage: page,
          commitFiles: files,
          filesLoading: false,
          selectedFile: active && files.some((file) => file.newPath === active || file.oldPath === active) ? active : files.length > 0 ? pathOf(files[0]) : null,
        });
      })
      .catch((error: unknown) => {
        if (current() && get().selectedOid === oid) set({ filesLoading: false, filesError: String(error) });
      });
  },

  selectPr: (pr, sourceRepoRoot) => {
    const repoRoot = sourceRepoRoot ?? useGitStore.getState().repoRoot;
    if (!repoRoot || repoRoot !== useGitStore.getState().repoRoot) return;
    set({
      repoRoot,
      selectedPr: pr,
      selectedPrRepoRoot: repoRoot,
      selectedOid: null,
      commitFiles: [],
      prDiff: null,
      selectedFile: null,
      filesLoading: true,
    });
    get().loadPrPage(1);
  },

  loadPrPage: (page) => {
    const { selectedPr: pr, selectedPrRepoRoot: repoRoot, prDiff } = get();
    if (!repoRoot || !pr || useGitStore.getState().repoRoot !== repoRoot) return;
    const request = ++diffGeneration;
    const vault = useVaultStore.getState().vault;
    const current = () => request === diffGeneration && get().selectedPr === pr && get().selectedPrRepoRoot === repoRoot
      && useGitStore.getState().repoRoot === repoRoot && useVaultStore.getState().vault === vault;
    set({ prPage: page, prDiff: null, selectedFile: null, filesLoading: true, filesError: null });
    void githubPrDiffPage(repoRoot, pr.number, page, prDiff?.headOid ?? pr.headOid ?? null, prDiff?.baseOid ?? pr.baseOid ?? null)
      .then((value) => {
        if (!current()) return;
        set({
          prDiff: value,
          filesLoading: false,
          selectedFile: value.items[0]?.newPath ?? value.items[0]?.oldPath ?? null,
        });
      })
      .catch((error: unknown) => {
        if (current()) set({ filesLoading: false, filesError: String(error) });
      });
  },

  selectFile: (selectedFile) => set({ selectedFile }),
}));

// Synchronous retirement closes the interval before React remounts repository panels.
useGitStore.subscribe((state, before) => { if (state.repoRoot !== before.repoRoot) useGitGraphStore.getState().clearRepository(); });
useVaultStore.subscribe((state, before) => { if (state.vault !== before.vault) useGitGraphStore.getState().clearRepository(); });
