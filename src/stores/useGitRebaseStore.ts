import { create } from 'zustand';
import { gitRebaseStatus } from '../ipc/git';
import { isCurrentGitScope, type GitWorktreeScope } from '../editor/gitWorktreeMutation';
import type { GitRebaseOutcome, GitRebaseStatus } from '../types/git';

interface GitRebaseState {
  scope: GitWorktreeScope | null;
  status: GitRebaseStatus | null;
  loading: boolean;
  busy: boolean;
  cancelling: boolean;
  requestId: string | null;
  error: string | null;
  outcome: GitRebaseOutcome | null;
  load: (scope: GitWorktreeScope | null) => Promise<void>;
}

let sequence = 0;

export const useGitRebaseStore = create<GitRebaseState>((set, get) => ({
  scope: null, status: null, loading: false, busy: false, cancelling: false,
  requestId: null, error: null, outcome: null,
  load: async (scope) => {
    if (scope && !isCurrentGitScope(scope)) return;
    if (scope && get().busy && get().scope?.vault === scope.vault) return;
    const request = ++sequence;
    if (!scope) { set({ scope: null, status: null, loading: false, busy: false, cancelling: false, requestId: null, error: null, outcome: null }); return; }
    const changed = get().scope?.vault !== scope.vault || get().scope?.repoRoot !== scope.repoRoot;
    set({ scope, loading: true, ...(changed ? { status: null, busy: false, cancelling: false, requestId: null, error: null, outcome: null } : {}) });
    try {
      const status = await gitRebaseStatus(scope.repoRoot);
      if (request !== sequence || !isCurrentGitScope(scope) || get().busy) return;
      set({ status, loading: false, error: null, outcome: null });
    } catch (error) {
      if (request !== sequence || !isCurrentGitScope(scope) || get().busy) return;
      set({ loading: false, error: error instanceof Error ? error.message : String(error), outcome: 'failed' });
    }
  },
}));
