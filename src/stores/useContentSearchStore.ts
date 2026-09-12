import { create } from 'zustand';
import { queryContent, type ContentHit } from '../ipc/indexService';
import { captureIndexScope, isCurrentIndexScope } from '../ipc/indexScope';
import { useVaultStore } from './useVaultStore';

/**
 * 全文搜索结果镜像（命令面板 `#` 模式，v1.2 #2a）。
 *
 * 异步 FTS5 查询不适配同步 provider.getItems：故经本 store 落地——面板侧防抖触发 run(term)，
 * contentProvider.getItems 同步读 hits。seq 守卫只采纳「最新一次」查询结果：用户连打时，先发后归的
 * 旧查询结果（含被 clear 作废的在途查询）一律丢弃，避免乱序覆盖面板。
 */
interface ContentSearchState {
  /** 当前生效的查询词（无 `#` 前缀，已 trim 前的原值由调用方处理）；onSelect 据此自校准定位。 */
  term: string;
  hits: ContentHit[];
  loading: boolean;
  error: string | null;
  run: (term: string) => Promise<void>;
  clear: () => void;
}

let seq = 0;

export const useContentSearchStore = create<ContentSearchState>((set) => ({
  term: '',
  hits: [],
  loading: false,
  error: null,
  run: async (term) => {
    const mine = ++seq;
    const owner = useVaultStore.getState().vault;
    const scope = captureIndexScope();
    const current = () => useVaultStore.getState().vault === owner &&
      (scope ? isCurrentIndexScope(scope) : captureIndexScope() === null);
    set({ term, hits: [], loading: true, error: null });
    try {
      const hits = await queryContent(term);
      if (mine !== seq) return;
      if (!current()) { set({ hits: [], loading: false, error: null }); return; }
      set({ hits, loading: false, error: null });
    } catch (error) {
      if (mine !== seq) return;
      set({ hits: [], loading: false, error: current() ? (error instanceof Error ? error.message : String(error)) : null });
    }
  },
  clear: () => {
    seq++; // 作废在途查询，避免其结果回填已清空的面板。
    set({ term: '', hits: [], loading: false, error: null });
  },
}));
