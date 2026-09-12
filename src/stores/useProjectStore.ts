import { create } from 'zustand';
import type { ProjectCatalog, ProjectRecord } from '../types/projects';

export type ProjectPhase = 'idle' | 'loading' | 'saving' | 'opening' | 'restoring';
interface ProjectState {
  catalog: ProjectCatalog;
  /** Runtime owner, published only with the editor/workspace handover. Catalog activeId is a startup preference. */
  activeId: string | null;
  ready: boolean;
  phase: ProjectPhase;
  error: string | null;
  archiveOpen: boolean;
  snapshotStatus: 'idle' | 'saving' | 'saved' | 'error';
  snapshotError: string | null;
  setArchiveOpen: (open: boolean) => void;
}
export const useProjectStore = create<ProjectState>((set) => ({
  catalog: { version: 1, activeId: null, projects: [] },
  activeId: null,
  ready: false, phase: 'idle', error: null, archiveOpen: false,
  snapshotStatus: 'idle', snapshotError: null,
  setArchiveOpen: (archiveOpen) => set({ archiveOpen }),
}));
export function activeProject(): ProjectRecord | null {
  const { catalog, activeId } = useProjectStore.getState();
  return catalog.projects.find((project) => project.id === activeId && !project.removed) ?? null;
}
export function projectBlocksEditing(): boolean {
  const state = useProjectStore.getState();
  return state.archiveOpen || state.phase !== 'idle';
}
