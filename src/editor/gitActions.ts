import * as git from '../ipc/git';
import { useGitGraphStore } from '../stores/useGitGraphStore';
import { useGitStore } from '../stores/useGitStore';
import { confirmDestructive } from '../stores/useConfirmStore';
import { promptInput } from '../stores/usePromptStore';
import { showToast } from '../stores/useToastStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import type { GitOpResult, ResetMode } from '../types/git';

/**
 * git 写操作编排（Phase 6 GIT-03，非 React 模块，经 getState 调用）。
 *
 * 统一纪律：① 危险操作（弃改动 checkout / reset --hard / 删分支删 tag / revert）先 confirmDestructive 二次确认；
 * ② 命名/信息经 promptInput 输入；③ 成功后 refreshAfter 重刷 useGitStore + git-graph（成功无 toast，UI 刷新即反馈，
 * ToastKind 仅 error/warning）；④ 失败/冲突 → toast。仓库根取自 useGitStore.repoRoot（非 git 工作区静默 no-op）。
 */

function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}

function repo(): string | null {
  return useGitStore.getState().repoRoot;
}

/** 写后重刷：状态/分支 + （若 git-graph 打开）提交图。 */
async function refreshAfter(repoRoot: string): Promise<void> {
  await useGitStore.getState().refresh();
  if (useWorkbenchStore.getState().centralView === 'gitGraph') {
    await useGitGraphStore.getState().loadLog(repoRoot);
  }
}

/** 冲突结果 → 警告 + 「撤销」中止入口（merge/cherry-pick/revert 共用）。 */
function reportConflict(res: GitOpResult, label: string): void {
  if (res.conflicted) {
    showToast(
      'warning',
      `${label}产生冲突：请在工作区解决冲突后提交，或点「撤销」中止本次${label}。`,
      () => void abortOp(),
    );
  }
}

/** 中止进行中的 merge/cherry-pick/revert（冲突卡死时的安全出口）。 */
export async function abortOp(): Promise<void> {
  const root = repo();
  if (!root) return;
  try {
    await git.gitAbortOp(root);
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `中止失败：${errText(e)}`);
  }
}

/** 提交更改（暂存全部 + 签名提交）。 */
export async function commitChanges(): Promise<void> {
  const root = repo();
  if (!root) return;
  // 冲突中间态防误提交字面冲突标记：有未解决冲突文件先确认（解决后提交是正途，但提醒勿提交未解决标记 / 可中止）。
  const status = useGitStore.getState().status;
  if (status?.files.some((f) => f.status === 'conflicted')) {
    const ok = await confirmDestructive({
      title: '仍有未解决的冲突',
      body: '存在未解决的冲突文件。请确认已移除全部 <<<<<<< 冲突标记后再提交，否则会把冲突标记提交进历史。',
      confirmLabel: '我已解决，继续提交',
    });
    if (!ok) return;
  }
  const message = await promptInput({
    title: '提交更改',
    label: '提交信息（Conventional Commits）',
    placeholder: 'feat: ...',
    confirmLabel: '提交',
    multiline: true,
  });
  if (message === null) return;
  try {
    await git.gitCommit(root, message);
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `提交失败：${errText(e)}`);
  }
}

/** checkout 分支/提交；失败（多为未提交改动）→ 询问是否丢弃并强制切换。 */
export async function checkoutTarget(target: string): Promise<void> {
  const root = repo();
  if (!root) return;
  try {
    await git.gitCheckout(root, target, false);
    await refreshAfter(root);
  } catch (e) {
    const msg = errText(e);
    // 仅「未提交改动冲突」才提示丢弃强切；其它真错误（找不到目标/内部错误等）直接报错，绝不诱导丢无关数据。
    if (!/未提交改动|冲突|conflict/i.test(msg)) {
      showToast('error', `切换失败：${msg}`);
      return;
    }
    const ok = await confirmDestructive({
      title: '切换失败',
      body: `切换到「${target}」失败，可能有未提交改动。丢弃这些改动并强制切换？此操作不可恢复。`,
      confirmLabel: '丢弃改动并切换',
    });
    if (!ok) return;
    try {
      await git.gitCheckout(root, target, true);
      await refreshAfter(root);
    } catch (e2) {
      showToast('error', `切换失败：${errText(e2)}`);
    }
  }
}

/** 在某提交（null=HEAD）创建分支并切过去。 */
export async function createBranchAt(targetOid: string | null): Promise<void> {
  const root = repo();
  if (!root) return;
  const name = await promptInput({ title: '创建分支', label: '分支名', confirmLabel: '创建' });
  if (name === null) return;
  try {
    await git.gitCreateBranch(root, name, targetOid, true);
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `创建分支失败：${errText(e)}`);
  }
}

/** 删除本地分支（二次确认）。 */
export async function deleteBranchNamed(name: string): Promise<void> {
  const root = repo();
  if (!root) return;
  const ok = await confirmDestructive({
    title: '删除分支',
    body: `删除分支「${name}」？未合并的提交可能丢失。`,
    confirmLabel: '删除',
  });
  if (!ok) return;
  try {
    await git.gitDeleteBranch(root, name);
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `删除分支失败：${errText(e)}`);
  }
}

/** 合并分支到当前分支。 */
export async function mergeBranchInto(branch: string): Promise<void> {
  const root = repo();
  if (!root) return;
  try {
    reportConflict(await git.gitMerge(root, branch), '合并');
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `合并失败：${errText(e)}`);
  }
}

/** cherry-pick 一个提交到当前分支。 */
export async function cherryPickCommit(oid: string): Promise<void> {
  const root = repo();
  if (!root) return;
  try {
    reportConflict(await git.gitCherryPick(root, oid), 'cherry-pick');
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `cherry-pick 失败：${errText(e)}`);
  }
}

/** revert 一个提交（二次确认）。 */
export async function revertCommit(oid: string): Promise<void> {
  const root = repo();
  if (!root) return;
  const ok = await confirmDestructive({
    title: '撤销提交',
    body: `生成一个反向提交以撤销 ${oid.slice(0, 8)} 的更改？`,
    confirmLabel: '撤销提交',
  });
  if (!ok) return;
  try {
    reportConflict(await git.gitRevert(root, oid), 'revert');
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `revert 失败：${errText(e)}`);
  }
}

/** reset 到某提交（soft/mixed/hard；hard 强确认）。 */
export async function resetTo(oid: string, mode: ResetMode): Promise<void> {
  const root = repo();
  if (!root) return;
  const ok = await confirmDestructive({
    title: `reset --${mode}`,
    body:
      mode === 'hard'
        ? `reset --hard 到 ${oid.slice(0, 8)} 会丢弃所有未提交改动，不可恢复。确认？`
        : `把当前分支 reset 到 ${oid.slice(0, 8)}（--${mode}）？`,
    confirmLabel: mode === 'hard' ? '丢弃改动并 reset' : '确认 reset',
  });
  if (!ok) return;
  try {
    await git.gitReset(root, oid, mode, mode === 'hard');
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `reset 失败：${errText(e)}`);
  }
}

/** 在某提交（null=HEAD）创建轻量 tag。 */
export async function createTagAt(targetOid: string | null): Promise<void> {
  const root = repo();
  if (!root) return;
  const name = await promptInput({ title: '创建标签', label: '标签名', confirmLabel: '创建' });
  if (name === null) return;
  try {
    await git.gitTagCreate(root, name, targetOid, null);
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `创建标签失败：${errText(e)}`);
  }
}

/** 删除 tag（二次确认）。 */
export async function deleteTagNamed(name: string): Promise<void> {
  const root = repo();
  if (!root) return;
  const ok = await confirmDestructive({
    title: '删除标签',
    body: `删除标签「${name}」？`,
    confirmLabel: '删除',
  });
  if (!ok) return;
  try {
    await git.gitTagDelete(root, name);
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `删除标签失败：${errText(e)}`);
  }
}

/** 暂存当前改动（含未跟踪）。 */
export async function stashChanges(): Promise<void> {
  const root = repo();
  if (!root) return;
  const message = await promptInput({
    title: '暂存改动',
    label: '备注（可留空）',
    placeholder: 'WIP',
    confirmLabel: '暂存',
  });
  if (message === null) return;
  try {
    await git.gitStashSave(root, message);
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `暂存失败：${errText(e)}`);
  }
}
