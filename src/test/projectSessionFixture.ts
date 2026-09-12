import { vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history } from '@codemirror/commands';
import type { ProjectCatalog, ProjectDocument, ProjectRecord, ProjectSnapshot, StoredProjectSession } from '../types/projects';

const nativeIO = vi.hoisted(() => ({
  open: vi.fn(), files: vi.fn(), start: vi.fn(), stop: vi.fn(), read: vi.fn(), write: vi.fn(),
  catalog: vi.fn(), register: vi.fn(), activate: vi.fn(), session: vi.fn(), begin: vi.fn(), commit: vi.fn(), abort: vi.fn(), restore: vi.fn(),
  flush: vi.fn(), quietIndex: vi.fn(), rebuild: vi.fn(),
}));
vi.mock('../ipc/projects', () => ({
  readProjectCatalog: nativeIO.catalog, registerProject: nativeIO.register, activateProjectRecord: nativeIO.activate,
  readProjectSession: nativeIO.session, beginProjectSnapshot: nativeIO.begin, commitProjectSnapshot: nativeIO.commit,
  abortProjectSnapshot: nativeIO.abort, restoreProjectBackup: nativeIO.restore,
}));
vi.mock('../ipc/vault', () => ({ openVault: nativeIO.open, listDir: async () => [], listFiles: nativeIO.files, findRepoRoot: async () => null }));
vi.mock('../ipc/events', () => ({ startWatch: nativeIO.start, stopWatch: nativeIO.stop }));
vi.mock('../ipc/files', async (original) => ({ ...await original<typeof import('../ipc/files')>(), readFile: nativeIO.read, writeFileAtomic: nativeIO.write, createFile: vi.fn(async () => null) }));
vi.mock('../stores/autosave', async (original) => ({ ...await original<typeof import('../stores/autosave')>(), flushAutosave: nativeIO.flush }));
vi.mock('../ipc/indexSession', async (original) => ({ ...await original<typeof import('../ipc/indexSession')>(), indexRebuild: nativeIO.rebuild, quiesceIndexSession: nativeIO.quietIndex }));
vi.mock('../editor/codex', () => ({ refreshCodex: async () => {} }));
export const projectIO = nativeIO;

import { useEditorStore } from '../stores/useEditorStore';
import { useProjectStore } from '../stores/useProjectStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useGitStore } from '../stores/useGitStore';
import { useGitOperationStore } from '../stores/useGitOperationStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { setView } from '../editor/viewHandle';
import { __clearCacheForTest } from '../editor/editorState';
import { resetAutosave } from '../stores/autosave';
import { forgetAcceptedProject, stopProjectCheckpoints } from '../projects/session';

export const PROJECT_IDS = { '/A': '00000000-0000-4000-8000-00000000000a', '/B': '00000000-0000-4000-8000-00000000000b', '/C': '00000000-0000-4000-8000-00000000000c', '/missing': '00000000-0000-4000-8000-00000000000d' };
export const projectFixture = {
  view: null as EditorView | null,
  watch: null as string | null,
  catalog: null as ProjectCatalog | null,
  sessions: new Map<string | null, StoredProjectSession>(),
  backups: new Map<string | null, StoredProjectSession>(),
  preserved: new Map<string | null, StoredProjectSession[]>(),
  content: new Map<string, string>(),
};
const sessionRoot = (id: string | null) => `/app-data/sessions/${id ?? 'unfiled'}`;
function record(id: string, root: string): ProjectRecord { return { id, root, name: root, favorite: false, cover: null, createdAt: 1, lastOpenedAt: 1, removed: false }; }

export function seedProjectSession(id: string | null, documents: Array<Partial<ProjectDocument> & { path: string; text: string }>, activePath: string | null = documents[0]?.path ?? null): StoredProjectSession {
  const version = crypto.randomUUID();
  const docs: ProjectDocument[] = documents.map(({ text, ...item }, index) => {
    const key = item.key ?? `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const contentFile = `versions/${version}/${key}.txt`;
    projectFixture.content.set(`${sessionRoot(id)}/${contentFile}`, text);
    return { key, name: item.name ?? item.path, external: false, draft: item.path.startsWith('draft://'), dirty: false,
      contentFile, anchor: 0, head: 0, scrollTop: 0, renderMode: 'source', ...item };
  });
  const workbench = useWorkbenchStore.getState();
  const stored: StoredProjectSession = { root: sessionRoot(id), snapshot: { version: 1, revision: 1, documents: docs, activePath, mode: 'standard', layouts: structuredClone(workbench.layouts), activeTool: 'outline' } };
  projectFixture.sessions.set(id, stored);
  return stored;
}

export function setupProjectSessionFixture(): void {
  stopProjectCheckpoints(); resetAutosave(); __clearCacheForTest();
  for (const id of [null, ...Object.values(PROJECT_IDS)]) forgetAcceptedProject(id);
  projectFixture.sessions.clear(); projectFixture.backups.clear(); projectFixture.preserved.clear(); projectFixture.content.clear();
  projectFixture.catalog = { version: 1, activeId: PROJECT_IDS['/A'], projects: Object.entries(PROJECT_IDS).map(([root, id]) => record(id, root)) };
  projectFixture.watch = '/A';
  for (const mock of Object.values(projectIO)) mock.mockReset();
  projectIO.open.mockImplementation(async (root: string) => ({ root, name: root, repoRoot: null }));
  projectIO.files.mockResolvedValue([]);
  projectIO.start.mockImplementation(async (root: string) => { projectFixture.watch = root; });
  projectIO.stop.mockImplementation(async () => { projectFixture.watch = null; });
  projectIO.read.mockImplementation(async (root: string, path: string) => {
    const value = projectFixture.content.get(`${root}/${path}`);
    if (value === undefined) throw new Error(`fixture missing ${root}/${path}`);
    return value;
  });
  projectIO.write.mockImplementation(async (root: string, path: string, content: string) => { projectFixture.content.set(`${root}/${path}`, content); return null; });
  projectIO.catalog.mockImplementation(async () => structuredClone(projectFixture.catalog));
  projectIO.register.mockImplementation(async (id: string, root: string, name: string) => {
    const existing = projectFixture.catalog!.projects.find((item) => item.root === root);
    if (existing) return { ...existing };
    const added = { ...record(id, root), name }; projectFixture.catalog!.projects.push(added); return { ...added };
  });
  projectIO.activate.mockImplementation(async (id: string | null) => { projectFixture.catalog!.activeId = id; return structuredClone(projectFixture.catalog); });
  projectIO.session.mockImplementation(async (id: string | null) => structuredClone(projectFixture.sessions.get(id) ?? { root: sessionRoot(id), snapshot: null }));
  const tickets = new Map<string, { id: string | null; root: string; entries: Array<{ key: string; path: string; contentFile: string }> }>();
  projectIO.begin.mockImplementation(async (id: string | null, token: string, expected: number, keys: string[]) => {
    if ((projectFixture.sessions.get(id)?.snapshot?.revision ?? 0) !== expected) throw new Error('fixture snapshot revision changed');
    const ticket = { id, root: sessionRoot(id), entries: keys.map((key) => ({ key, path: `stage/${token}/${key}.txt`, contentFile: `versions/${token}/${key}.txt` })) };
    tickets.set(token, ticket); return { ...ticket, token };
  });
  projectIO.commit.mockImplementation(async (id: string | null, token: string, snapshot: ProjectSnapshot) => {
    const ticket = tickets.get(token); if (!ticket || ticket.id !== id) throw new Error('fixture no snapshot lease');
    for (const entry of ticket.entries) {
      const body = projectFixture.content.get(`${ticket.root}/${entry.path}`);
      if (body === undefined) throw new Error('fixture missing written body');
      projectFixture.content.set(`${ticket.root}/${entry.contentFile}`, body);
    }
    const stored = { root: sessionRoot(id), snapshot: { ...structuredClone(snapshot), revision: snapshot.revision + 1 } };
    projectFixture.backups.set(id, structuredClone(projectFixture.sessions.get(id) ?? stored));
    projectFixture.sessions.set(id, stored); tickets.delete(token); return structuredClone(stored);
  });
  projectIO.abort.mockImplementation(async (_id: string | null, token: string) => { tickets.delete(token); return null; });
  projectIO.restore.mockImplementation(async (id: string | null, kind: string) => {
    if (kind !== 'session') throw new Error('fixture only models session restoration');
    const backup = projectFixture.backups.get(id);
    if (!backup) throw new Error('fixture no selected backup');
    const current = projectFixture.sessions.get(id);
    if (current) projectFixture.preserved.set(id, [...(projectFixture.preserved.get(id) ?? []), structuredClone(current)]);
    projectFixture.sessions.set(id, structuredClone(backup));
    return null;
  });
  projectIO.quietIndex.mockResolvedValue(undefined); projectIO.rebuild.mockResolvedValue(null);
  useSettingsStore.setState({ simpleMode: true, autosaveEnabled: false });
  useGitOperationStore.setState({ current: null });
  useGitStore.setState({ repoRoot: null, status: null });
  useProjectStore.setState({ ...useProjectStore.getInitialState(), ready: true, activeId: PROJECT_IDS['/A'], catalog: structuredClone(projectFixture.catalog) });
  useVaultStore.setState({ vault: { root: '/A', repoRoot: null, name: 'A', projectId: PROJECT_IDS['/A'] }, tree: [], files: [], expanded: new Set(), lastVaultPath: '/A', recentVaults: ['/A'] });
  useEditorStore.setState({ ...useEditorStore.getInitialState(), tabs: [{ path: 'same.md', name: 'same.md' }], activePath: 'same.md' });
  projectFixture.view = new EditorView({ state: EditorState.create({ doc: 'A 的完整正文', extensions: [history()] }) });
  setView(projectFixture.view);
  projectFixture.content.set('/A/same.md', 'A 的完整正文');
  projectIO.flush.mockImplementation(async (path: string) => {
    useEditorStore.getState().clearDirty(path);
    const root = useVaultStore.getState().vault?.root;
    if (root && useEditorStore.getState().activePath === path) projectFixture.content.set(`${root}/${path}`, projectFixture.view!.state.doc.toString());
    return { kind: 'saved' };
  });
}

export function teardownProjectSessionFixture(): void {
  stopProjectCheckpoints(); resetAutosave(); setView(null); projectFixture.view?.destroy(); projectFixture.view = null; __clearCacheForTest();
}
