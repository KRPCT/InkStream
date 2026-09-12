import { pickFolder, pickProjectCover } from '../ipc/dialog';
import * as repository from '../ipc/projects';
import { useProjectStore } from '../stores/useProjectStore';
import { basename } from '../editor/pathUtil';
import { checkpointProject, forgetAcceptedProject, initializeProjects, openProjectSession, recoverProjectSessionBackup } from './session';
import type { ProjectRecord } from '../types/projects';

async function refresh(): Promise<void> { useProjectStore.setState({ catalog: await repository.readProjectCatalog() }); }
async function report<T>(action: () => Promise<T>): Promise<T> {
  try { const result = await action(); useProjectStore.setState({ error: null }); return result; }
  catch (error) { useProjectStore.setState({ error: error instanceof Error ? error.message : String(error) }); throw error; }
}
export const openProject = (id: string | null): Promise<boolean> => openProjectSession(id);
export async function openProjectDirectory(root: string): Promise<boolean> {
  await initializeProjects();
  return report(async () => {
    const record = await repository.registerProject(crypto.randomUUID(), root, basename(root));
    await refresh();
    return openProject(record.id);
  });
}
export async function addProjectDirectory(): Promise<ProjectRecord | null> {
  const root = await pickFolder();
  if (!root) return null;
  return report(async () => {
    const record = await repository.registerProject(crypto.randomUUID(), root, basename(root));
    await refresh();
    return await openProject(record.id) ? record : null;
  });
}
export const renameProject = (id: string, name: string) => report(async () => { await repository.updateProject(id, { name }); await refresh(); });
export const setProjectFavorite = (id: string, favorite: boolean) => report(async () => { await repository.updateProject(id, { favorite }); await refresh(); });
export const relocateProject = (id: string) => report(async () => {
  const root = await pickFolder(); if (!root) return;
  const active = id === useProjectStore.getState().activeId;
  if (active && !await openProject(null)) return;
  await repository.relocateProjectRoot(id, root); forgetAcceptedProject(id); await refresh();
  if (active) await openProject(id);
});
export const importProjectCover = (id: string) => report(async () => {
  const path = await pickProjectCover(); if (!path) return;
  await repository.copyProjectCover(id, path); await refresh();
});
export const removeProject = (id: string) => report(async () => {
  if (id === useProjectStore.getState().activeId && !await openProject(null)) return;
  await repository.removeProjectRecord(id); await refresh();
});
export const retryProjectSnapshot = () => checkpointProject();
export const recoverProjectBackup = (id: string | null, kind: 'catalog' | 'session') => report(async () => {
  if (kind === 'session') await recoverProjectSessionBackup(id);
  else await repository.restoreProjectBackup(id, kind);
  await refresh();
  if (!useProjectStore.getState().ready) await initializeProjects();
});
