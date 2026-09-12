import { create } from 'zustand';
import type { GitWorktreeScope } from '../editor/gitWorktreeMutation';

interface GitOperationState {
  current: { scope: GitWorktreeScope; requestId: string; label: string; cancelling: boolean } | null;
}
export const useGitOperationStore = create<GitOperationState>(() => ({ current: null }));
