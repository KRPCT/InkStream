import { create } from 'zustand';
import type { GitClonePhase } from '../types/gitClone';

interface GitCloneState {
  open: boolean;
  url: string;
  parent: string;
  folder: string;
  phase: GitClonePhase;
  requestId: string | null;
  progress: string[];
  error: string | null;
  clonedPath: string | null;
}

/** 仅保存克隆表单/任务状态；当前工作区仍由既有vault生命周期管理。 */
export const useGitCloneStore = create<GitCloneState>(() => ({
  open: false, url: '', parent: '', folder: '', phase: 'editing', requestId: null,
  progress: [], error: null, clonedPath: null,
}));
