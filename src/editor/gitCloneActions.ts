import { pickFolder } from '../ipc/dialog';
import { gitCancelClone, gitClone } from '../ipc/git';
import { useGitCloneStore } from '../stores/useGitCloneStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { isAbsolutePath, stripVerbatim } from './pathUtil';
import { switchVault } from './vaultFlow';

let formGeneration = 0;
let pickGeneration = 0;

export function cloneBusy(): boolean {
  return ['cloning', 'cancelling', 'opening'].includes(useGitCloneStore.getState().phase);
}

export function repositoryFolder(url: string): string {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
  return last.replace(/\.git$/i, '');
}

export function cloneDestination(parent: string, folder: string): string {
  return stripVerbatim(parent).replace(/\\/g, '/').replace(/\/+$/, '') + '/' + folder.trim();
}

export function cloneInputError(): string | null {
  const { url, parent, folder } = useGitCloneStore.getState();
  if (useSettingsStore.getState().gitRemoteMode === 'local') return '当前为仅本地模式，请先选择远程方式。';
  if (!url.trim()) return '请填写仓库 URL。';
  if (!parent || !isAbsolutePath(parent)) return '请选择目标父目录。';
  const name = folder.trim();
  const hasControlCharacter = Array.from(name).some((character) => (character.codePointAt(0) ?? 32) < 32);
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name) || hasControlCharacter || /[. ]$/.test(name)) return '请填写不含路径分隔符的新目录名称。';
  return null;
}

function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    const residue = 'residualPath' in error && typeof error.residualPath === 'string' ? `\n保留的目录：${error.residualPath}` : '';
    return error.message + residue;
  }
  return typeof error === 'string' ? error : '克隆失败，请重试。';
}

export function requestCloneRepository(): void {
  if (cloneBusy()) { useGitCloneStore.setState({ open: true }); return; }
  ++formGeneration;
  const state = useGitCloneStore.getState();
  const url = state.url || (useSettingsStore.getState().gitRemoteMode === 'custom' ? useSettingsStore.getState().gitCustomServer.trim() : '');
  useGitCloneStore.setState({ open: true, url, folder: state.folder || repositoryFolder(url), phase: 'editing', error: null, clonedPath: null, progress: [], requestId: null });
}

export function setCloneUrl(url: string): void {
  if (cloneBusy()) return;
  const previous = useGitCloneStore.getState();
  const folder = !previous.folder || previous.folder === repositoryFolder(previous.url) ? repositoryFolder(url) : previous.folder;
  useGitCloneStore.setState({ url, folder, error: null });
}

export async function selectCloneParent(): Promise<void> {
  if (cloneBusy()) return;
  const generation = formGeneration;
  const pick = ++pickGeneration;
  try {
    const parent = await pickFolder();
    if (generation === formGeneration && pick === pickGeneration && useGitCloneStore.getState().open && !cloneBusy() && parent !== null) {
      useGitCloneStore.setState({ parent, error: null });
    }
  } catch (error) {
    if (generation === formGeneration && pick === pickGeneration) useGitCloneStore.setState({ error: message(error) });
  }
}

export async function startCloneRepository(): Promise<void> {
  if (cloneBusy()) return;
  const error = cloneInputError();
  if (error) { useGitCloneStore.setState({ error }); return; }
  const { url, parent, folder } = useGitCloneStore.getState();
  const requestId = crypto.randomUUID();
  useGitCloneStore.setState({ phase: 'cloning', requestId, progress: [], error: null, clonedPath: null });
  try {
    const path = await gitClone(url.trim(), cloneDestination(parent, folder), ({ line }) => {
      const state = useGitCloneStore.getState();
      if (state.requestId !== requestId || !['cloning', 'cancelling'].includes(state.phase)) return;
      const text = line.trim().slice(0, 1024);
      if (text) useGitCloneStore.setState({ progress: [...state.progress.slice(-99), text] });
    }, requestId);
    if (useGitCloneStore.getState().requestId !== requestId) return;
    if (!path) throw new Error('克隆未返回有效目录。');
    // 任务完成只记录真实路径；打开始终是后续显式操作，不随晚到结果自动切库。
    useGitCloneStore.setState({ phase: 'cloned', requestId: null, clonedPath: path, error: null });
  } catch (failure) {
    if (useGitCloneStore.getState().requestId !== requestId) return;
    const cancelled = failure instanceof DOMException && failure.name === 'AbortError'
      || !!failure && typeof failure === 'object' && 'code' in failure && failure.code === 'cancelled';
    useGitCloneStore.setState({ phase: cancelled ? 'cancelled' : 'failed', requestId: null, error: message(failure), clonedPath: null });
  }
}

export async function cancelCloneRepository(): Promise<void> {
  const { phase, requestId } = useGitCloneStore.getState();
  if (phase !== 'cloning' || !requestId) return;
  useGitCloneStore.setState({ phase: 'cancelling', error: null });
  try {
    const accepted = await gitCancelClone(requestId);
    if (!accepted && useGitCloneStore.getState().requestId === requestId) {
      useGitCloneStore.setState({ phase: 'cloning', error: '尚未确认停止，请重试取消。' });
    }
  } catch (error) {
    if (useGitCloneStore.getState().requestId === requestId) useGitCloneStore.setState({ phase: 'cloning', error: `取消请求失败：${message(error)}` });
  }
}

export function dismissCloneDialog(): void {
  if (useGitCloneStore.getState().phase === 'opening') return;
  if (cloneBusy()) { void cancelCloneRepository(); return; }
  ++formGeneration;
  ++pickGeneration;
  useGitCloneStore.setState({ open: false });
}

export function configureCloneRemote(): void {
  if (cloneBusy()) return;
  dismissCloneDialog();
  useSettingsUiStore.getState().openSettings('git');
}

export async function openClonedRepository(): Promise<void> {
  const { phase, clonedPath } = useGitCloneStore.getState();
  if (phase !== 'cloned' || !clonedPath) return;
  useGitCloneStore.setState({ phase: 'opening', error: null });
  try {
    const opened = await switchVault(clonedPath);
    useGitCloneStore.setState({ phase: 'cloned', open: !opened, error: opened ? null : '仓库已克隆，当前工作区保持不变。' });
  } catch (error) {
    useGitCloneStore.setState({ phase: 'cloned', error: `仓库已克隆，但打开失败：${message(error)}` });
  }
}
