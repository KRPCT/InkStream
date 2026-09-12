import { create } from 'zustand';
import { getDocForPath } from '../editor/editorState';
import { searchFile, type FileMatches } from '../editor/multibuffer/projectSearch';
import { readFile } from '../ipc/files';
import { queryContentPaths } from '../ipc/indexService';
import { useVaultStore } from './useVaultStore';
import type { VaultInfo } from '../types/vault';

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
  status: 'idle' | 'searching' | 'done' | 'error';
  error: string | null;
  scope: VaultInfo | null;
  run: (query: string) => Promise<void>;
  cancel: () => void;
  clear: () => void;
}

let seq = 0;
let running: AbortController | null = null;

export const useProjectSearchStore = create<ProjectSearchState>((set, get) => ({
  query: '',
  results: [],
  totalMatches: 0,
  truncated: false,
  status: 'idle',
  error: null,
  scope: null,
  run: async (query) => {
    running?.abort();
    const controller = new AbortController();
    running = controller;
    const mine = ++seq;
    const term = query.trim();
    const scope = useVaultStore.getState().vault;
    set({ query: term, results: [], totalMatches: 0, truncated: false, status: 'searching', error: null, scope });
    const root = scope?.root ?? null;
    const stale = () => {
      if (mine !== seq) return true;
      if (!controller.signal.aborted && useVaultStore.getState().vault === scope) return false;
      set({ query: '', results: [], totalMatches: 0, truncated: false, status: 'idle', scope: null });
      return true;
    };
    if (!term || root === null) {
      // 空词 / 无 vault：不召回，直接收敛空结果。
      if (mine === seq) set({ results: [], totalMatches: 0, truncated: false, status: 'done' });
      if (running === controller) running = null;
      return;
    }
    const unsubscribe = useVaultStore.subscribe((state) => { if (state.vault !== scope) controller.abort(); });
    try {
    const paths = await queryContentPaths(term, CANDIDATE_CAP + 1, { signal: controller.signal });
    if (stale()) return;
    const truncated = paths.length > CANDIDATE_CAP;
    const results: FileMatches[] = [];
    let foundMatches = 0; let excerptUnits = 0;
    // Sequential admission leaves native slots for navigation and avoids 500 queued deadlines.
    for (const path of paths.slice(0, CANDIDATE_CAP)) {
      if (stale()) return;
      const content = getDocForPath(path) ?? await readFile(root, path, { signal: controller.signal }).catch((error: unknown) => {
        throw new Error(`无法读取搜索候选「${path}」：${error instanceof Error ? error.message : String(error)}。结果尚未完整，请重试。`);
      });
      if (stale()) return;
      const matches = searchFile(path, content, term, { contextLines: CONTEXT_LINES, maximumMatches: 20_000, maximumExcerptUnits: 1_000_000 });
      if (matches) {
        foundMatches += matches.matchCount;
        excerptUnits += matches.excerpts.reduce((units, excerpt) => units + excerpt.text.length, 0);
        if (foundMatches > 50_000 || excerptUnits > 2_000_000) throw new Error('搜索结果超过显示预算，请收窄关键词。未返回部分结果。');
        results.push(matches);
      }
    }
    if (stale()) return;
    results.sort((a, b) => a.path.localeCompare(b.path));
    const totalMatches = results.reduce((n, r) => n + r.matchCount, 0);
    set({ results, totalMatches, truncated, status: 'done' });
    } catch (error) {
      if (!stale()) set({ results: [], totalMatches: 0, status: 'error', error: error instanceof Error ? error.message : '搜索失败，请重试' });
    } finally {
      unsubscribe();
      if (running === controller) running = null;
      controller.abort();
    }
  },
  cancel: () => {
    seq++;
    running?.abort(); running = null;
    if (get().status === 'searching') set({ status: 'idle', error: null });
  },
  clear: () => {
    seq++; // 作废在途查询。
    running?.abort(); running = null;
    set({ query: '', results: [], totalMatches: 0, truncated: false, status: 'idle', scope: null, error: null });
  },
}));
