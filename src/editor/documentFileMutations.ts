import { movePath, renamePath, trashPath } from '../ipc/files';
import { indexRebuild } from '../ipc/indexService';
import {
  beginFileMutation, cancelPendingAutosave, resumeAutosave, scheduleAutosave,
  suspendAutosave, waitForPendingAutosaves,
} from '../stores/autosave';
import { useEditorStore, type TabMeta } from '../stores/useEditorStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { showToast } from '../stores/useToastStore';
import { useVaultStore } from '../stores/useVaultStore';
import { queueAfterComposition } from './composition';
import { nextDraft } from './draftPath';
import { getDocForPath, reapplyImageContext, rekeyState, snapshotBeforeSwitch } from './editorState';
import { beginDocumentNavigation } from './editorState.navigation';
import { serializeDocumentTransition } from './documentTransitions';
import { basename } from './pathUtil';
import { getView } from './viewHandle';

function below(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function openBelow(prefix: string): TabMeta[] {
  return useEditorStore.getState().tabs.filter((tab) => !tab.external && below(tab.path, prefix));
}

function commitAfterComposition(commit: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const apply = () => {
      try { commit(); resolve(); } catch (error) { reject(error); }
    };
    const view = getView();
    if (view) queueAfterComposition(view, 'file-identity-mutation', apply);
    else apply();
  });
}

function snapshotActive(affected: readonly TabMeta[]): void {
  const active = useEditorStore.getState().activePath;
  const view = getView();
  if (view && active && affected.some((tab) => tab.path === active)) snapshotBeforeSwitch(view, active);
}

function resumeDirtyDocuments(): void {
  const { tabs, dirty, frozen } = useEditorStore.getState();
  for (const { path } of tabs) if (dirty[path] && !frozen[path]) scheduleAutosave(path);
}

async function rebuildAfterMutation(root: string): Promise<void> {
  if (useSettingsStore.getState().simpleMode) return;
  await indexRebuild(root).catch(() => {
    if (useVaultStore.getState().vault?.root === root) showToast('warning', '文件修改已完成，但索引重建失败，请重试重建索引。');
  });
}

/** OS mutation and document identity migration share one admission boundary with workspace changes. */
async function mutateDocumentPaths(
  root: string,
  paths: readonly string[],
  write: () => Promise<unknown>,
  commit: () => void,
  validate?: () => void,
): Promise<boolean> {
  const requestedVault = useVaultStore.getState().vault;
  if (requestedVault?.root !== root) return false;
  return serializeDocumentTransition(async () => {
    const current = () => useVaultStore.getState().vault === requestedVault;
    if (!current()) return false;
    suspendAutosave();
    cancelPendingAutosave();
    const releaseEvents = beginFileMutation(paths);
    let committed = false;
    try {
      await waitForPendingAutosaves();
      if (!current()) return false;
      validate?.();
      beginDocumentNavigation();
      await write();
      committed = true;
      await commitAfterComposition(() => {
        if (!current()) throw new Error('文件修改后工作区已变化，请重新打开工作区。');
        beginDocumentNavigation();
        commit();
      });
      await rebuildAfterMutation(root);
      return true;
    } finally {
      releaseEvents(committed);
      resumeAutosave();
      if (current()) resumeDirtyDocuments();
    }
  });
}

function relocateDocumentPath(root: string, from: string, to: string, kind: 'rename' | 'move'): Promise<boolean> {
  if (from === to) return Promise.resolve(false);
  return mutateDocumentPaths(root, [from, to],
    () => kind === 'rename' ? renamePath(root, from, to) : movePath(root, from, to),
    () => {
      const latest = openBelow(from);
      snapshotActive(latest);
      for (const tab of latest) {
        const next = to + tab.path.slice(from.length);
        rekeyState(tab.path, next);
        useEditorStore.getState().rehomeTab(tab.path, next, false, basename(next));
        reapplyImageContext(next);
      }
    },
    () => {
      const affected = openBelow(from);
      const oldPaths = new Set(affected.map((tab) => tab.path));
      const destinations = new Set(affected.map((tab) => to + tab.path.slice(from.length)));
      if (useEditorStore.getState().tabs.some((tab) => destinations.has(tab.path) && !oldPaths.has(tab.path))) {
        throw new Error('目标路径已有打开文档，请先处理该文档。');
      }
    });
}

export function renameDocumentPath(root: string, from: string, to: string): Promise<boolean> {
  return relocateDocumentPath(root, from, to, 'rename');
}

export function moveDocumentPath(root: string, from: string, to: string): Promise<boolean> {
  return relocateDocumentPath(root, from, to, 'move');
}

/** Delete the disk entry only; each open buffer becomes an explicitly named unsaved draft. */
export function removeDocumentPath(root: string, from: string): Promise<boolean> {
  return mutateDocumentPaths(root, [from], () => trashPath(root, from), () => {
    const latest = openBelow(from);
    snapshotActive(latest);
    for (const tab of latest) {
      const draftPath = `${nextDraft().path}/${basename(tab.path)}`;
      rekeyState(tab.path, draftPath);
      const store = useEditorStore.getState();
      store.rehomeTab(tab.path, draftPath, false, `${tab.name}（已删除草稿）`);
      store.markDirty(draftPath);
      store.unfreezeAutosave(draftPath);
      store.clearExternalChange(draftPath);
      // Keep the source image context until Save As chooses a real new location.
    }
    if (latest.length) showToast('warning', `已移到回收站；${latest.length} 份打开文档的最新内容已保留为草稿，请另存为。`);
  }, () => {
    const missing = openBelow(from).find((tab) => getDocForPath(tab.path) === null);
    if (missing) throw new Error(`「${missing.name}」的编辑缓冲暂不可用，请先打开该文档再删除。`);
  });
}
