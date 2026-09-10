import { readFile } from '../ipc/files';
import { useEditorStore, type TabMeta } from '../stores/useEditorStore';
import { showToast } from '../stores/useToastStore';
import { isDraftPath } from './draftPath';
import { getDocForPath, invalidateDocumentState, reloadFromDisk } from './editorState';
import type { GitWorktreeScope } from './gitWorktreeMutation';
import { basename, parentDir, relativeWithin } from './pathUtil';

export function documentRepoPath(scope: GitWorktreeScope, tab: TabMeta): string | null {
  if (isDraftPath(tab.path)) return null;
  const absolute = tab.external ? tab.path : `${scope.vaultRoot.replace(/[/\\]+$/, '')}/${tab.path}`;
  return relativeWithin(absolute, scope.repoRoot);
}

export function repositoryDocuments(scope: GitWorktreeScope): TabMeta[] {
  return useEditorStore.getState().tabs.filter((tab) => documentRepoPath(scope, tab) !== null);
}

export function sameDocumentText(a: string, b: string): boolean {
  return a.replace(/\r\n?/g, '\n') === b.replace(/\r\n?/g, '\n');
}

function preserve(path: string): void {
  const editor = useEditorStore.getState();
  editor.markDirty(path);
  editor.freezeAutosave(path);
  editor.markExternalChange(path);
}

/** Compare the actual post-Git files; unchanged buffers retain their undo/cache state even on failure. */
export async function reconcileGitDocuments(
  scope: GitWorktreeScope,
  current: () => boolean,
  preservedDirty: ReadonlySet<string>,
  accepted: ReadonlyMap<string, string>,
  paths?: ReadonlySet<string>,
): Promise<void> {
  for (const tab of repositoryDocuments(scope)) {
    if (paths && !paths.has(documentRepoPath(scope, tab)!)) continue;
    if (!current()) return;
    const before = getDocForPath(tab.path);
    if (before === null) { invalidateDocumentState(tab.path); continue; }
    let disk: string;
    try {
      disk = await readFile(tab.external ? parentDir(tab.path) : scope.vaultRoot, tab.external ? basename(tab.path) : tab.path);
    } catch {
      if (current() && useEditorStore.getState().tabs.includes(tab)) {
        preserve(tab.path);
        showToast('warning', `Git 操作后无法读取「${tab.name}」，编辑内容已保留，请重试读取或另存为。`);
      }
      continue;
    }
    if (!current() || !useEditorStore.getState().tabs.includes(tab)) continue;
    const latest = getDocForPath(tab.path);
    const expected = accepted.get(tab.path);
    const explicitResolution = expected !== undefined && latest !== null && sameDocumentText(latest, expected);
    if (latest !== before || (!explicitResolution && (useEditorStore.getState().dirty[tab.path] || preservedDirty.has(tab.path)))) {
      preserve(tab.path);
      continue;
    }
    if (explicitResolution) {
      const editor = useEditorStore.getState();
      editor.clearDirty(tab.path);
      editor.unfreezeAutosave(tab.path);
      editor.clearExternalChange(tab.path);
    }
    if (sameDocumentText(before, disk)) continue;
    if (useEditorStore.getState().activePath !== tab.path) { invalidateDocumentState(tab.path); continue; }
    try {
      await reloadFromDisk(tab.path);
    } catch {
      if (current() && useEditorStore.getState().tabs.includes(tab)) {
        preserve(tab.path);
        showToast('warning', `「${tab.name}」的磁盘内容已由 Git 改变，当前编辑已保留，请处理外部变化。`);
      }
    }
  }
}
