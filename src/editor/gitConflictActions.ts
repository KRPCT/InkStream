import { gitSaveConflict } from '../ipc/gitConflict';
import type { ConflictBaseline } from '../types/gitConflict';
import { useEditorStore } from '../stores/useEditorStore';
import { useGitRebaseStore } from '../stores/useGitRebaseStore';
import { showToast } from '../stores/useToastStore';
import { getDocForPath } from './editorState';
import { documentRepoPath, repositoryDocuments, sameDocumentText } from './gitWorktreeDocuments';
import { isCurrentGitScope, runGitWorktreeMutation, type GitWorktreeScope } from './gitWorktreeMutation';

/** A conflict choice belongs to one captured file revision in one repository/workspace. */
export async function resolveGitConflict(scope: GitWorktreeScope, path: string, expectedContent: string, content: string, baseline: ConflictBaseline, signal?: AbortSignal): Promise<boolean> {
  if (!isCurrentGitScope(scope)) return false;
  const accepted = new Map<string, string>();
  for (const tab of repositoryDocuments(scope)) {
    if (documentRepoPath(scope, tab) !== path) continue;
    const body = getDocForPath(tab.path);
    if (body === null) continue;
    const state = useEditorStore.getState();
    if ((state.dirty[tab.path] || state.frozen[tab.path] || state.externalChanged[tab.path]) && !sameDocumentText(body, expectedContent)) {
      showToast('warning', '来源文件还有未保存的不同编辑，未覆盖当前内容。请先保存或处理外部变化。');
      return false;
    }
    accepted.set(tab.path, body);
  }
  const result = await runGitWorktreeMutation(scope, () => gitSaveConflict(scope.repoRoot, path, baseline, content, signal), {
    preserveDirty: true, acceptedBuffers: accepted, paths: [path], signal,
  });
  if (result.kind !== 'executed' || !isCurrentGitScope(scope)) return false;
  await useGitRebaseStore.getState().load(scope);
  return isCurrentGitScope(scope);
}
