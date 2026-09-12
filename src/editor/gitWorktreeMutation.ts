import { useGitStore } from '../stores/useGitStore';
import { useGitGraphStore } from '../stores/useGitGraphStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { VaultInfo } from '../types/vault';
import { startWatch, stopWatch } from '../ipc/events';
import { pauseIndexSession } from '../ipc/indexService';
import { cancelPendingAutosave, flushAutosave, resumeAutosave, scheduleAutosave, suspendAutosave, waitForPendingAutosaves } from '../stores/autosave';
import { useEditorStore } from '../stores/useEditorStore';
import { showToast } from '../stores/useToastStore';
import { queueAfterComposition } from './composition';
import { getDocForPath } from './editorState';
import { beginDocumentNavigation } from './editorState.navigation';
import { serializeDocumentTransition } from './documentTransitions';
import { refreshTree } from './fileTreeData';
import { documentRepoPath, reconcileGitDocuments, repositoryDocuments, sameDocumentText } from './gitWorktreeDocuments';
import { getView } from './viewHandle';

export interface GitWorktreeScope {
  readonly repoRoot: string;
  readonly vault: VaultInfo;
  readonly vaultRoot: string;
}

export function captureGitWorktreeScope(): GitWorktreeScope | null {
  const vault = useVaultStore.getState().vault;
  const repoRoot = useGitStore.getState().repoRoot;
  return vault && repoRoot && vault.repoRoot === repoRoot ? Object.freeze({ repoRoot, vault, vaultRoot: vault.root }) : null;
}

export interface GitWorktreeOptions {
  preserveDirty?: boolean;
  signal?: AbortSignal;
  /** One explicit conflict-resolution write may replace exactly the accepted buffer revision. */
  acceptedBuffers?: ReadonlyMap<string, string>;
  /** Known narrow mutations, such as resolving one file, do not freeze unrelated dirty buffers. */
  paths?: readonly string[];
}

export function isCurrentGitScope(scope: GitWorktreeScope): boolean {
  return useVaultStore.getState().vault === scope.vault && scope.vault.root === scope.vaultRoot && useGitStore.getState().repoRoot === scope.repoRoot;
}

function compositionSettled(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { signal?.removeEventListener('abort', done); resolve(); };
    if (signal?.aborted) { done(); return; }
    signal?.addEventListener('abort', done, { once: true });
    const view = getView();
    if (view) queueAfterComposition(view, 'git-worktree-admission', done);
    else done();
  });
}

function resumeDirty(): void {
  const { tabs, dirty, frozen } = useEditorStore.getState();
  for (const tab of tabs) if (dirty[tab.path] && !frozen[tab.path]) scheduleAutosave(tab.path);
}

/** Worktree writes share document/workspace admission and reconcile the real result before resuming saves. */
export async function runGitWorktreeMutation<T>(
  scope: GitWorktreeScope,
  write: () => Promise<T>,
  options: GitWorktreeOptions = {},
): Promise<{ kind: 'executed'; value: T } | { kind: 'blocked' }> {
  return serializeDocumentTransition(async () => {
    const current = () => isCurrentGitScope(scope);
    const admitted = () => current() && !options.signal?.aborted;
    const paths = options.paths ? new Set(options.paths) : undefined;
    const documents = () => repositoryDocuments(scope).filter((tab) => !paths || paths.has(documentRepoPath(scope, tab)!));
    const blocked = { kind: 'blocked' } as const;
    if (!admitted()) return blocked;
    await compositionSettled(options.signal);
    if (!admitted()) return blocked;
    const accepted = options.acceptedBuffers ?? new Map<string, string>();
    for (const [path, expected] of accepted) {
      const body = getDocForPath(path);
      if (body === null || !sameDocumentText(body, expected)) {
        showToast('warning', '编辑内容已变化，请重新读取冲突后再保存选择。');
        return blocked;
      }
    }
    const preservedDirty = new Set(documents().filter((tab) => useEditorStore.getState().dirty[tab.path]).map((tab) => tab.path));
    if (!options.preserveDirty) {
      for (const tab of documents()) {
        if (!admitted()) return blocked;
        if (!useEditorStore.getState().dirty[tab.path] || accepted.has(tab.path)) continue;
        const outcome = await flushAutosave(tab.path);
        if (outcome.kind !== 'saved') {
          if (outcome.kind !== 'failed') showToast('warning', '文档仍有新修改或未处理的冲突，Git 操作尚未开始。');
          resumeDirty();
          return blocked;
        }
      }
      preservedDirty.clear();
    }
    suspendAutosave();
    cancelPendingAutosave();
    let resumeIndex: (() => Promise<null>) | null = null;
    let watchTouched = false;
    let attempted = false;
    let succeeded = false;
    try {
      await waitForPendingAutosaves();
      if (!admitted()) return blocked;
      if (!options.preserveDirty && documents().some((tab) => useEditorStore.getState().dirty[tab.path] && !accepted.has(tab.path))) {
        showToast('warning', '保存期间又有新修改，Git 操作尚未开始。');
        return blocked;
      }
      resumeIndex = await pauseIndexSession(scope.vaultRoot);
      if (!admitted()) return blocked;
      watchTouched = true;
      await stopWatch();
      if (!admitted()) return blocked;
      for (const [path, expected] of accepted) {
        const body = getDocForPath(path);
        if (body === null || !sameDocumentText(body, expected)) {
          showToast('warning', '编辑内容已变化，未写入旧的冲突选择。');
          return blocked;
        }
      }
      beginDocumentNavigation();
      attempted = true;
      const value = await write();
      succeeded = true;
      return { kind: 'executed', value };
    } finally {
      if (attempted && current()) {
        beginDocumentNavigation();
        await compositionSettled();
        try {
          await reconcileGitDocuments(scope, current, preservedDirty, succeeded ? accepted : new Map(), paths);
          if (current()) await refreshTree();
          if (current()) await useGitStore.getState().refresh();
          if (current() && useWorkbenchStore.getState().centralView === 'gitGraph') {
            await useGitGraphStore.getState().loadLog(scope.repoRoot);
          }
        } catch {
          if (current()) showToast('warning', 'Git 操作已返回，但文档列表恢复失败，请刷新工作区；当前编辑内容仍保留。');
        }
      }
      if (watchTouched && current()) {
        try { await startWatch(scope.vaultRoot); }
        catch { showToast('error', '工作区文件监听恢复失败，请重新打开工作区。'); }
      }
      if (resumeIndex) {
        try { await resumeIndex(); }
        catch { if (current()) showToast('warning', 'Git 操作后索引恢复失败，请重建索引。'); }
      }
      resumeAutosave();
      if (current()) resumeDirty();
    }
  });
}
