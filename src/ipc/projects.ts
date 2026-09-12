import { invoke } from './invoke';
import type { ProjectSnapshot } from '../types/projects';

export const readProjectCatalog = () => invoke('project_catalog_get', undefined);
export const registerProject = (id: string, root: string, name: string) => invoke('project_register', { id, root, name });
export const updateProject = (id: string, patch: { name?: string; favorite?: boolean }) => invoke('project_update', { id, ...patch });
export const relocateProjectRoot = (id: string, root: string) => invoke('project_relocate', { id, root });
export const removeProjectRecord = (id: string) => invoke('project_remove', { id });
export const activateProjectRecord = (id: string | null) => invoke('project_activate', { id });
export const copyProjectCover = (id: string, path: string) => invoke('project_import_cover', { id, path });
export const readProjectSession = (id: string | null) => invoke('project_session_read', { id });
export const beginProjectSnapshot = (id: string | null, token: string, expectedRevision: number, keys: string[]) => invoke('project_session_begin', { id, token, expectedRevision, keys });
export const commitProjectSnapshot = (id: string | null, token: string, snapshot: ProjectSnapshot) => invoke('project_session_commit', { id, token, snapshot });
export const abortProjectSnapshot = (id: string | null, token: string) => invoke('project_session_abort', { id, token });
export const restoreProjectBackup = (id: string | null, kind: 'catalog' | 'session') => invoke('project_restore_backup', { id, kind });
