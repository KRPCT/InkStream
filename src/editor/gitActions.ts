import * as git from '../ipc/git';
import { useGitGraphStore } from '../stores/useGitGraphStore';
import { useGitStore } from '../stores/useGitStore';
import { confirmDestructive } from '../stores/useConfirmStore';
import { promptInput } from '../stores/usePromptStore';
import { showToast } from '../stores/useToastStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import type { GitOpResult, GitProgress, ResetMode } from '../types/git';

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

/**
 * 全量重刷 git 全局状态：状态栏分支/脏标记（useGitStore）+ 提交图（useGitGraphStore）一并刷新。
 * 供 GitGraph 自身的刷新入口（刷新按钮 / 进入视图）调用——这两条路径以前只刷图谱、不刷 useGitStore，
 * 而 watcher 又跳过 `.git/*` 事件，导致左下角状态栏冻结在旧分支/旧脏标记（git 全局状态不同步）。
 */
export async function refreshGitAll(repoRoot: string): Promise<void> {
  await useGitStore.getState().refresh();
  await useGitGraphStore.getState().loadLog(repoRoot);
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

/**
 * 用给定信息提交（暂存全部 + 签名提交）。返回是否成功。
 * 供侧栏内联提交（簇①）与命令式提交复用。冲突中间态先确认防误提交字面冲突标记。
 */
export async function commitWithMessage(message: string): Promise<boolean> {
  const root = repo();
  if (!root || !message.trim()) return false;
  const status = useGitStore.getState().status;
  if (status?.files.some((f) => f.status === 'conflicted')) {
    const ok = await confirmDestructive({
      title: '仍有未解决的冲突',
      body: '存在未解决的冲突文件。请确认已移除全部 <<<<<<< 冲突标记后再提交，否则会把冲突标记提交进历史。',
      confirmLabel: '我已解决，继续提交',
    });
    if (!ok) return false;
  }
  try {
    await git.gitCommit(root, message);
    await refreshAfter(root);
    return true;
  } catch (e) {
    showToast('error', `提交失败：${errText(e)}`);
    return false;
  }
}

/** 提交更改（弹输入框拿提交信息 → commitWithMessage）。 */
export async function commitChanges(): Promise<void> {
  if (repo() === null) return;
  const message = await promptInput({
    title: '提交更改',
    label: '提交信息（Conventional Commits）',
    placeholder: 'feat: ...',
    confirmLabel: '提交',
    multiline: true,
  });
  if (message === null) return;
  await commitWithMessage(message);
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

// ── 远程操作（W4，SSH；远程名默认 origin）。进度写 useGitGraphStore.remoteBusy ──────────

/** 进度回调 → 更新 remoteBusy 文案（git --progress 行，如 "Receiving objects: 50% (5/10)"）。 */
function onProg(label: string, p: GitProgress): void {
  if (p.line) {
    useGitGraphStore.setState({ remoteBusy: `${label}：${p.line}` });
  }
}

/** 当前分支名（无则提示并返回 null）。 */
function currentBranch(action: string): string | null {
  const branch = useGitStore.getState().status?.branch ?? null;
  if (!branch) showToast('warning', `当前未在分支上，无法${action}。`);
  return branch;
}

/** fetch 远程（更新远程跟踪分支，不改工作区）。 */
export async function fetchRemote(): Promise<void> {
  const root = repo();
  if (!root) return;
  useGitGraphStore.setState({ remoteBusy: '获取中…' });
  try {
    await git.gitFetch(root, 'origin', (p) => onProg('获取', p));
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `获取失败：${errText(e)}`);
  } finally {
    useGitGraphStore.setState({ remoteBusy: null });
  }
}

/** 推送当前分支到 origin。 */
export async function pushCurrent(): Promise<void> {
  const root = repo();
  if (!root) return;
  const branch = currentBranch('推送');
  if (!branch) return;
  useGitGraphStore.setState({ remoteBusy: '推送中…' });
  try {
    await git.gitPush(root, 'origin', branch, (p) => onProg('推送', p));
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `推送失败：${errText(e)}`);
  } finally {
    useGitGraphStore.setState({ remoteBusy: null });
  }
}

/** 拉取当前分支（fast-forward 自动；分叉提示手动处理）。 */
export async function pullCurrent(): Promise<void> {
  const root = repo();
  if (!root) return;
  const branch = currentBranch('拉取');
  if (!branch) return;
  useGitGraphStore.setState({ remoteBusy: '拉取中…' });
  try {
    const outcome = await git.gitPull(root, 'origin', branch, (p) => onProg('拉取', p));
    if (outcome.kind === 'diverged') {
      showToast('warning', '本地与远程已分叉，请手动合并或 rebase 后再推送。');
    }
    await refreshAfter(root);
  } catch (e) {
    showToast('error', `拉取失败：${errText(e)}`);
  } finally {
    useGitGraphStore.setState({ remoteBusy: null });
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
