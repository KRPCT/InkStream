import type { AppMode } from './settings';
import type { ModeLayout } from './workbench';
import type { RenderMode } from './editor';

export interface ProjectRecord {
  id: string;
  root: string;
  name: string;
  favorite: boolean;
  cover: string | null;
  createdAt: number;
  lastOpenedAt: number;
  removed: boolean;
}
export interface ProjectCatalog {
  version: 1;
  activeId: string | null;
  projects: ProjectRecord[];
}
export interface ProjectDocument {
  key: string;
  path: string;
  name: string;
  external: boolean;
  draft: boolean;
  dirty: boolean;
  contentFile: string;
  anchor: number;
  head: number;
  scrollTop: number;
  renderMode: RenderMode | null;
}
export interface ProjectSnapshot {
  version: 1;
  revision: number;
  documents: ProjectDocument[];
  activePath: string | null;
  mode: AppMode;
  layouts: Record<AppMode, ModeLayout>;
  activeTool: string;
}
export interface StoredProjectSession {
  root: string;
  snapshot: ProjectSnapshot | null;
}
export interface ProjectSnapshotTicket {
  token: string;
  root: string;
  entries: Array<{ key: string; path: string; contentFile: string }>;
}
