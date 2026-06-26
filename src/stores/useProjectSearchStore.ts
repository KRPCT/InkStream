import { create } from 'zustand';
import { getDocForPath } from '../editor/editorState';
import { searchFile, type FileMatches } from '../editor/multibuffer/projectSearch';
import { readFile } from '../ipc/files';
import { queryContentPaths } from '../ipc/indexService';
import { useVaultStore } from './useVaultStore';

/**
 * 全库搜索结果镜像（#2c multibuffer 的数据驱动层，仿 useContentSearchStore 的 seq 防乱序）。
 *
 * 流水：trigram 召回候选文件名单（queryContentPaths）→ 逐文件取「当前真相源」内容（getDocForPath ?? readFile，
 * 避免对正在主编辑器里改的文件读到陈旧盘内容，复用 CR-01 纪律）→ 纯函数 searchFile 算精确命中与摘录。
 * seq 守卫只采纳最新一次查询；候选超 CAP 置 truncated（replace-all 须知未覆盖全集）。
 */

const CANDIDATE_CAP = 500;
const CONTEXT_LINES = 1;

interface ProjectSearchState {
  /** 当前生效查询词（已 trim）。 */
  query: string;
  results: FileMatches[];
  totalMatches: number;
  /** 候选名单触顶（结果可能不全，replace-all 据此提示收窄）。 */
  truncated: boolean;
  status: 'idle' | 'searching' | 'done';
  run: (query: string) => Promise<void>;
  clear: () => void;
}

let seq = 0;

export const useProjectSearchStore = create<ProjectSearchState>((set) => ({
  query: '',
  results: [],
  totalMatches: 0,
  truncated: false,
  status: 'idle',
  run: async (query) => {
    const mine = ++seq;
    const term = query.trim();
    set({ query: term, status: 'searching' });
    const root = useVaultStore.getState().vault?.root ?? null;
    if (term.length < 3 || root === null) {
      // 短词（trigram 下限）/ 无 vault：不召回，直接收敛空结果（UI 据 status+query 提示）。
      if (mine === seq) set({ results: [], totalMatches: 0, truncated: false, status: 'done' });
      return;
    }
    const paths = await queryContentPaths(term, CANDIDATE_CAP);
    if (mine !== seq) return; // 已被更晚查询取代。
    const truncated = paths.length >= CANDIDATE_CAP;
    const settled = await Promise.all(
      paths.map(async (path) => {
        // 优先取主编辑器真相源（活动 view / 缓存态）；未开文件才读盘，读失败（已删）→ 跳过。
        const content = getDocForPath(path) ?? (await readFile(root, path).catch(() => null));
        return content === null ? null : searchFile(path, content, term, { contextLines: CONTEXT_LINES });
      }),
    );
    if (mine !== seq) return;
    const results = settled.filter((r): r is FileMatches => r !== null);
    results.sort((a, b) => a.path.localeCompare(b.path));
    const totalMatches = results.reduce((n, r) => n + r.matchCount, 0);
    set({ results, totalMatches, truncated, status: 'done' });
  },
  clear: () => {
    seq++; // 作废在途查询。
    set({ query: '', results: [], totalMatches: 0, truncated: false, status: 'idle' });
  },
}));
