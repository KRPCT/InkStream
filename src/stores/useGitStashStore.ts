import { create } from 'zustand';
import { gitStashList } from '../ipc/git';
import { isCurrentGitScope, type GitWorktreeScope } from '../editor/gitWorktreeMutation';
import type { StashEntry } from '../types/git';

interface StashState {
  scope: GitWorktreeScope | null;
  entries: StashEntry[];
  loading: boolean;
  busy: boolean;
  requestId: number | null;
  error: string | null;
  load: (scope: GitWorktreeScope | null) => Promise<void>;
}

let sequence = 0;
export const useGitStashStore = create<StashState>((set, get) => ({
  scope: null, entries: [], loading: false, busy: false, requestId: null, error: null,
  load: async (scope) => {
    if (scope && !isCurrentGitScope(scope)) return;
    if (scope && get().busy && get().scope?.vault === scope.vault) return;
    const request = ++sequence;
    if (!scope) { set({ scope: null, entries: [], loading: false, busy: false, requestId: null, error: null }); return; }
    const changed = get().scope?.vault !== scope.vault || get().scope?.repoRoot !== scope.repoRoot;
    set({ scope, loading: true, ...(changed ? { entries: [], busy: false, requestId: null, error: null } : {}) });
    try {
      const entries = await gitStashList(scope.repoRoot);
      if (request === sequence && isCurrentGitScope(scope) && !get().busy) set({ entries, loading: false, error: null });
    } catch (error) {
      if (request === sequence && isCurrentGitScope(scope) && !get().busy) set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
