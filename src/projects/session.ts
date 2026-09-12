import type { Text } from '@codemirror/state';
import { readFile, writeFileAtomic } from '../ipc/files';
import { startWatch, stopWatch } from '../ipc/events';
import * as repository from '../ipc/projects';
import { captureIndexScope, suspendIndexScope } from '../ipc/indexScope';
import { indexRebuild, quiesceIndexSession } from '../ipc/indexSession';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useProjectStore } from '../stores/useProjectStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { useGitStore } from '../stores/useGitStore';
import { useGitOperationStore } from '../stores/useGitOperationStore';
import { useGitGraphStore } from '../stores/useGitGraphStore';
import { useProjectSearchStore } from '../stores/useProjectSearchStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { cancelPendingAutosave, flushAutosave, resumeAutosave, suspendAutosave, waitForPendingAutosaves } from '../stores/autosave';
import { captureEditorSession, installEditorSession, settleEditorComposition, type EditorSession, type SessionEditorEntry } from '../editor/editorState';
import { beginDocumentNavigation } from '../editor/editorState.navigation';
import { serializeDocumentTransition } from '../editor/documentTransitions';
import { isDraftPath, reserveDraftPaths } from '../editor/draftPath';
import { basename, parentDir } from '../editor/pathUtil';
import { prepareVault, publishVault } from '../editor/vaultFlow';
import { replaceSessionSources } from '../editor/sessionSources';
import { MODE_PRESETS } from '../modes/presets';
import type { ProjectDocument, ProjectSnapshot, StoredProjectSession } from '../types/projects';

interface AcceptedSession { stored: StoredProjectSession; documents: Map<string, Text>; editor?: EditorSession }
const accepted = new Map<string | null, AcceptedSession>();
let checkpointTail: Promise<void> = Promise.resolve();
let startup: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function currentLayout() {
  const state = useWorkbenchStore.getState();
  return { mode: state.mode, layouts: structuredClone(state.layouts), activeTool: state.activeTab };
}
function sameCheckpoint(before: AcceptedSession, editor: EditorSession, snapshot: ProjectSnapshot): boolean {
  return JSON.stringify(before.stored.snapshot) === JSON.stringify(snapshot) && editor.entries.every((entry) =>
    !entry.state || before.documents.get(entry.tab.path) === entry.state.doc);
}

/** Only this queue publishes checkpoints. The immutable CM Text is the comparison authority. */
export function checkpointProject(): Promise<void> {
  const id = useProjectStore.getState().activeId;
  const result = checkpointTail.then(async () => {
    if (id !== useProjectStore.getState().activeId || !useProjectStore.getState().ready) return;
    await settleEditorComposition();
    const editor = captureEditorSession();
    const before = accepted.get(id) ?? { stored: await repository.readProjectSession(id), documents: new Map<string, Text>() };
    const previous = new Map(before.stored.snapshot?.documents.map((doc) => [doc.path, doc]) ?? []);
    const changed: Array<{ key: string; entry: SessionEditorEntry }> = [];
    const documents: ProjectDocument[] = editor.entries.map((entry) => {
      const old = previous.get(entry.tab.path);
      const key = old?.key ?? crypto.randomUUID();
      if (entry.state ? !old || before.documents.get(entry.tab.path) !== entry.state.doc
        : !old || entry.source?.document.contentFile !== old.contentFile) changed.push({ key, entry });
      if (!entry.state && !entry.source) throw new Error(`「${entry.tab.name}」缺少恢复正文，尚未保存快照。`);
      return { key, path: entry.tab.path, name: entry.tab.name, external: !!entry.tab.external,
        draft: isDraftPath(entry.tab.path), dirty: entry.dirty, contentFile: old?.contentFile ?? '',
        anchor: entry.anchor, head: entry.head, scrollTop: entry.scrollTop, renderMode: entry.renderMode };
    });
    const snapshot: ProjectSnapshot = { version: 1, revision: before.stored.snapshot?.revision ?? 0,
      documents, activePath: editor.activePath, ...currentLayout() };
    if (sameCheckpoint(before, editor, snapshot)) return;
    useProjectStore.setState({ snapshotStatus: 'saving', snapshotError: null });
    const token = crypto.randomUUID();
    let leased = false;
    try {
      const ticket = await repository.beginProjectSnapshot(id, token, snapshot.revision, changed.map((item) => item.key));
      leased = true;
      for (const item of changed) {
        const target = ticket.entries.find((entry) => entry.key === item.key);
        if (!target) throw new Error('项目快照未返回完整的正文写入位置。');
        const text = item.entry.state?.doc.toString() ?? await readFile(item.entry.source!.root, item.entry.source!.document.contentFile);
        await writeFileAtomic(ticket.root, target.path, text);
        documents.find((document) => document.key === item.key)!.contentFile = target.contentFile;
      }
      const stored = await repository.commitProjectSnapshot(id, token, snapshot);
      leased = false;
      accepted.set(id, { stored, documents: new Map(editor.entries.flatMap((entry) => entry.state ? [[entry.tab.path, entry.state.doc] as const] : [])), editor });
      if (useProjectStore.getState().activeId === id) {
        replaceSessionSources((stored.snapshot?.documents ?? []).map((document) => ({ root: stored.root, document })));
        useProjectStore.setState({ snapshotStatus: 'saved', snapshotError: null });
      }
    } catch (error) {
      if (leased) await repository.abortProjectSnapshot(id, token).catch(() => {});
      useProjectStore.setState({ snapshotStatus: 'error', snapshotError: message(error) });
      throw error;
    }
  });
  checkpointTail = result.catch((error) => {
    if (useProjectStore.getState().activeId === id) useProjectStore.setState({ snapshotStatus: 'error', snapshotError: message(error) });
  });
  return result;
}

async function saveCurrentFiles(): Promise<void> {
  await settleEditorComposition();
  cancelPendingAutosave();
  await waitForPendingAutosaves();
  for (const tab of useEditorStore.getState().tabs) {
    if (isDraftPath(tab.path) || !useEditorStore.getState().dirty[tab.path]) continue;
    if ((await flushAutosave(tab.path)).kind !== 'saved') throw new Error(`「${tab.name}」尚未保存，请处理保存错误或外部冲突后重试。`);
  }
}

async function loadSession(id: string | null, root: string | null): Promise<{ editor: EditorSession; stored: StoredProjectSession }> {
  const stored = await repository.readProjectSession(id);
  const cached = accepted.get(id)?.editor;
  const entries: SessionEditorEntry[] = [];
  let activePath = stored.snapshot?.activePath ?? stored.snapshot?.documents[0]?.path ?? null;
  for (const doc of stored.snapshot?.documents ?? []) {
    const prior = cached?.entries.find((entry) => entry.tab.path === doc.path);
    const entry: SessionEditorEntry = { tab: { path: doc.path, name: doc.name, external: doc.external },
      state: prior?.state ?? null, anchor: doc.anchor, head: doc.head, scrollTop: doc.scrollTop,
      renderMode: doc.renderMode, dirty: doc.dirty, frozen: false, externalChanged: false,
      source: { root: stored.root, document: doc } };
    if (doc.draft || doc.dirty || doc.path === activePath || prior?.state) {
      const saved = async () => readFile(stored.root, doc.contentFile);
      if (doc.draft) entry.text = prior?.state?.doc.toString() ?? await saved();
      else {
        let disk: string;
        try { disk = await readFile(doc.external ? parentDir(doc.path) : root!, doc.external ? basename(doc.path) : doc.path); }
        catch {
          entry.text = await saved();
          entry.tab = { path: `draft://recovery-${doc.key}`, name: `${doc.name}（恢复副本）` };
          entry.dirty = true;
          entry.source = undefined;
          if (activePath === doc.path) activePath = entry.tab.path;
          entries.push(entry);
          continue;
        }
        const recovery = doc.dirty ? prior?.state?.doc.toString() ?? await saved() : disk;
        entry.text = recovery;
        entry.dirty = recovery.replace(/\r\n?/g, '\n') !== disk.replace(/\r\n?/g, '\n');
        entry.frozen = entry.dirty;
        entry.externalChanged = entry.dirty;
      }
    }
    entries.push(entry);
  }
  reserveDraftPaths(entries.map((entry) => entry.tab.path));
  return { editor: { entries, activePath }, stored };
}

function restoreLayout(snapshot: ProjectSnapshot | null): void {
  const workbench = useWorkbenchStore.getState();
  if (snapshot) {
    workbench.setMode(snapshot.mode);
    const tools = MODE_PRESETS[snapshot.mode].rightPanelTabs;
    const activeTab = tools.find((tab) => tab === snapshot.activeTool) ?? tools[0];
    const layouts = structuredClone(snapshot.layouts);
    for (const layout of Object.values(layouts)) {
      layout.sidebarWidth = Math.max(200, Math.min(480, layout.sidebarWidth));
      layout.rightPanelWidth = Math.max(240, Math.min(560, layout.rightPanelWidth));
    }
    useWorkbenchStore.setState({ layouts, activeTab });
  }
  useWorkbenchStore.setState({ centralView: 'editor', terminalOpen: false });
}

/** One transaction for project ownership, watcher, editor and startup preference. */
export function openProjectSession(id: string | null, initial = false): Promise<boolean> {
  return serializeDocumentTransition(async () => {
    const state = useProjectStore.getState();
    initial ||= !state.ready;
    if (!initial && id === state.activeId) { state.setArchiveOpen(false); return true; }
    if (useGitOperationStore.getState().current || useGitGraphStore.getState().remoteBusy) {
      useProjectStore.setState({ error: 'Git 操作仍在进行，请待其完成或取消后切换项目。' });
      return false;
    }
    const previousId = state.activeId;
    const oldVault = useVaultStore.getState();
    const oldLayout = currentLayout();
    const oldWorkbench = useWorkbenchStore.getState();
    let oldEditor: EditorSession | undefined;
    let switchedWatcher = false;
    let activated = false;
    let suspended = false;
    let resumeIndex: (() => void) | undefined;
    useProjectStore.setState({ phase: 'saving', error: null });
    beginDocumentNavigation();
    try {
      if (!initial) { await saveCurrentFiles(); await checkpointProject(); }
      else await settleEditorComposition();
      oldEditor = captureEditorSession();
      suspendAutosave(); suspended = true;
      cancelPendingAutosave(); await waitForPendingAutosaves();
      useProjectStore.setState({ phase: 'opening' });
      if (oldVault.vault) {
        const scope = captureIndexScope();
        resumeIndex = suspendIndexScope(oldVault.vault);
        await quiesceIndexSession(oldVault.vault.root, scope);
      }
      const project = id === null ? null : state.catalog.projects.find((item) => item.id === id && !item.removed);
      if (id && !project) throw new Error('项目记录不存在，请重新打开项目档案。');
      const prepared = project ? await prepareVault(project.root) : null;
      if (prepared && id) prepared.info = { ...prepared.info, projectId: id };
      const target = await loadSession(id, prepared?.info.root ?? null);
      await stopWatch(); switchedWatcher = true;
      if (prepared) await startWatch(prepared.info.root);
      const catalog = await repository.activateProjectRecord(id); activated = true;
      useProjectStore.setState({ phase: 'restoring' });
      useProjectSearchStore.getState().clear();
      if (prepared) publishVault(prepared);
      else { useVaultStore.getState().clearVault(); useVaultStore.getState().setLastVaultPath(null); useGitStore.getState().setRepoRoot(null); }
      installEditorSession(target.editor, prepared?.info.root ?? null);
      restoreLayout(target.stored.snapshot);
      accepted.set(id, { stored: target.stored, documents: new Map(target.editor.entries.flatMap((entry) => entry.state && !entry.text ? [[entry.tab.path, entry.state.doc] as const] : [])), editor: target.editor });
      // Retain undo for the two most recently visited projects; older checkpoints remain on disk.
      while (accepted.size > 3) {
        const oldest = [...accepted.keys()].find((key) => key !== id && key !== previousId);
        if (oldest === undefined) break;
        accepted.delete(oldest);
      }
      useProjectStore.setState({ catalog, activeId: id, ready: true, archiveOpen: false, phase: 'idle', snapshotStatus: 'saved', snapshotError: null });
      return true;
    } catch (error) {
      const recoveryErrors: string[] = [];
      if (switchedWatcher) {
        await stopWatch().catch((reason) => { recoveryErrors.push(message(reason)); });
        if (oldVault.vault) await startWatch(oldVault.vault.root).catch((reason) => { recoveryErrors.push(`原目录监听恢复失败：${message(reason)}`); });
        useVaultStore.setState({ vault: oldVault.vault, tree: oldVault.tree, files: oldVault.files, expanded: oldVault.expanded, lastVaultPath: oldVault.lastVaultPath });
        useGitStore.getState().setRepoRoot(oldVault.vault?.repoRoot ?? null);
        if (oldEditor) {
          try { installEditorSession(oldEditor, oldVault.vault?.root ?? null); }
          catch (reason) { recoveryErrors.push(`原编辑会话恢复失败：${message(reason)}`); }
        }
        useWorkbenchStore.getState().setMode(oldLayout.mode);
        useWorkbenchStore.setState({ layouts: oldLayout.layouts, activeTab: oldWorkbench.activeTab, centralView: oldWorkbench.centralView, terminalOpen: oldWorkbench.terminalOpen });
      }
      if (activated) await repository.activateProjectRecord(previousId).catch((reason) => { recoveryErrors.push(`启动项目记录恢复失败：${message(reason)}`); });
      useProjectStore.setState({ error: [message(error), ...recoveryErrors].join('\n'), phase: 'idle', archiveOpen: true });
      return false;
    } finally {
      if (suspended) resumeAutosave();
      resumeIndex?.();
      if (resumeIndex && useVaultStore.getState().vault === oldVault.vault && oldVault.vault && !useSettingsStore.getState().simpleMode) {
        void indexRebuild(oldVault.vault.root).catch(() => {});
      }
    }
  });
}

export function initializeProjects(): Promise<void> {
  if (startup) return startup;
  startup = (async () => {
    useProjectStore.setState({ phase: 'loading' });
    try {
      let catalog = await repository.readProjectCatalog();
      if (catalog.projects.length === 0) {
        const legacy = useVaultStore.getState();
        const roots = [...new Set([legacy.lastVaultPath, ...legacy.recentVaults].filter((root): root is string => !!root))];
        let lastId: string | null = null;
        for (const root of roots) {
          try { const record = await repository.registerProject(crypto.randomUUID(), root, basename(root)); if (root === legacy.lastVaultPath) lastId = record.id; }
          catch { /* Invalid legacy paths remain in the existing recent-path record. */ }
        }
        catalog = lastId ? await repository.activateProjectRecord(lastId) : await repository.readProjectCatalog();
      }
      useProjectStore.setState({ catalog });
      if (!await openProjectSession(catalog.activeId, true)) { startup = null; return; }
      startProjectCheckpoints();
    } catch (error) { useProjectStore.setState({ error: message(error), phase: 'idle', archiveOpen: true }); startup = null; }
  })();
  return startup;
}

let detach: (() => void) | undefined;
export function startProjectCheckpoints(): void {
  if (detach) return;
  const schedule = () => {
    if (!useProjectStore.getState().ready || useProjectStore.getState().phase !== 'idle') return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void checkpointProject().catch(() => {}); }, 900);
  };
  const editor = useEditorStore.subscribe(schedule);
  const layout = useWorkbenchStore.subscribe(schedule);
  document.addEventListener('scroll', schedule, true);
  detach = () => { editor(); layout(); document.removeEventListener('scroll', schedule, true); if (timer) clearTimeout(timer); detach = undefined; };
}
export function stopProjectCheckpoints(): void { detach?.(); }
export function prepareProjectExit(): Promise<boolean> {
  return serializeDocumentTransition(async () => {
    useProjectStore.setState({ phase: 'saving', error: null });
    try { await saveCurrentFiles(); await checkpointProject(); return true; }
    catch (error) { useProjectStore.setState({ error: message(error), archiveOpen: true }); return false; }
    finally { useProjectStore.setState({ phase: 'idle' }); }
  });
}

export function forgetAcceptedProject(id: string | null): void { accepted.delete(id); }

/** Restoring the active backup keeps unsaved buffers as recovery drafts before checkpointing. */
export function recoverProjectSessionBackup(id: string | null): Promise<void> {
  return serializeDocumentTransition(async () => {
    const active = useProjectStore.getState().ready && useProjectStore.getState().activeId === id;
    if (!active) {
      await repository.restoreProjectBackup(id, 'session');
      accepted.delete(id);
      return;
    }
    if (useGitOperationStore.getState().current || useGitGraphStore.getState().remoteBusy) throw new Error('请等待当前 Git 操作完成后恢复会话。');
    useProjectStore.setState({ phase: 'restoring', error: null });
    if (timer) clearTimeout(timer);
    let previous: EditorSession | undefined;
    const layout = currentLayout();
    const root = useVaultStore.getState().vault?.root ?? null;
    let restored = false;
    suspendAutosave();
    try {
      cancelPendingAutosave(); await waitForPendingAutosaves();
      // Waiting does not publish a new checkpoint or rotate the backup selected for restoration.
      await checkpointTail;
      await settleEditorComposition();
      previous = captureEditorSession();
      await repository.restoreProjectBackup(id, 'session');
      restored = true;
      accepted.delete(id);
      const target = await loadSession(id, root);
      for (const entry of previous.entries) {
        if (!entry.dirty && !isDraftPath(entry.tab.path)) continue;
        const text = entry.state?.doc.toString() ?? (entry.source ? await readFile(entry.source.root, entry.source.document.contentFile) : undefined);
        if (text === undefined) throw new Error('恢复前的编辑内容尚未就绪。');
        const same = target.editor.entries.some((candidate) => candidate.tab.path === entry.tab.path &&
          (candidate.text ?? candidate.state?.doc.toString()) === text);
        if (same) continue;
        const path = `draft://recovery-${crypto.randomUUID()}`;
        target.editor.entries.push({ ...entry, text, source: undefined, tab: { path, name: `${entry.tab.name}（恢复前编辑）` }, dirty: true, frozen: false, externalChanged: false });
        if (previous.activePath === entry.tab.path) target.editor.activePath = path;
      }
      if (target.editor.entries.length > 128) throw new Error('恢复后的文档超过 128 个；请先保存并关闭部分文档。原编辑仍保留。');
      installEditorSession(target.editor, root);
      restoreLayout(target.stored.snapshot);
      accepted.set(id, { stored: target.stored, documents: new Map(), editor: target.editor });
      await checkpointProject();
    } catch (error) {
      if (previous) installEditorSession(previous, root);
      useWorkbenchStore.getState().setMode(layout.mode);
      useWorkbenchStore.setState({ layouts: layout.layouts });
      if (restored) {
        accepted.set(id, { stored: await repository.readProjectSession(id), documents: new Map(), editor: previous });
      }
      useProjectStore.setState({ error: message(error), snapshotStatus: 'error', snapshotError: message(error) });
      throw error;
    } finally { resumeAutosave(); useProjectStore.setState({ phase: 'idle' }); }
  });
}
