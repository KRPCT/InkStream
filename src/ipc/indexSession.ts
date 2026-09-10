import { useIndexStore } from '../stores/useIndexStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useToastStore } from '../stores/useToastStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { IndexScope } from '../types/index';
import { closeIndexReads, retireIndexRead } from './indexConnection';
import { captureIndexScope, isCurrentIndexScope, isIndexScopePaused, resetIndexScope } from './indexScope';
import { invoke } from './invoke';

let prepared: { scope: IndexScope; promise: Promise<null> } | null = null;
let controls: Promise<void> = Promise.resolve();
const mutations = new Map<string, Promise<void>>();

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function recordIndexError(scope: IndexScope, error: unknown): void {
  if (isCurrentIndexScope(scope)) useIndexStore.setState({ status: 'error', error: message(error) });
}

function committed(scope: IndexScope): void {
  if (isCurrentIndexScope(scope)) useIndexStore.setState((s) => ({ revision: s.revision + 1 }));
}

function retire(scope: IndexScope): void {
  retireIndexRead(scope);
  mutations.delete(scope.sessionId);
  // 先撤销native准入，令正在进行的旧重建在下一批结束；旧prepare晚到也不能重开retired token。
  void invoke('index_switch_vault', { ...scope, enabled: false }).catch((error) => {
    if (captureIndexScope() === null) {
      useIndexStore.setState({ status: 'error', error: `索引停用失败：${message(error)}` });
      useToastStore.getState().showToast('error', '索引停用失败，请重新打开工作区后重试。');
    }
  });
}

function prepare(scope: IndexScope, rebuild: boolean, force: boolean): Promise<null> {
  if (!isCurrentIndexScope(scope)) return Promise.reject(new Error('索引工作区会话已过期'));
  if (!force && prepared?.scope.sessionId === scope.sessionId) {
    const state = useIndexStore.getState();
    if (state.status === 'error') return Promise.reject(new Error(state.error ?? '索引不可用，请重新构建'));
    return prepared.promise;
  }
  if (prepared && prepared.scope.sessionId !== scope.sessionId) retire(prepared.scope);
  if (force && rebuild) retireIndexRead(scope);
  const priorWrites = mutations.get(scope.sessionId) ?? Promise.resolve();
  const priorControl = controls;
  const promise = Promise.all([priorWrites, priorControl]).then(async () => {
    if (!isCurrentIndexScope(scope)) throw new Error('索引工作区会话已过期');
    await closeIndexReads();
    if (!isCurrentIndexScope(scope)) throw new Error('索引工作区会话已过期');
    if (rebuild) await invoke('index_rebuild', scope);
    else await invoke('index_switch_vault', { ...scope, enabled: true });
    if (isCurrentIndexScope(scope) && prepared?.promise === promise) {
      useIndexStore.setState({ scope, status: 'ready', error: null });
      committed(scope);
    }
    return null;
  }).catch((error: unknown) => {
    if (prepared?.promise === promise) recordIndexError(scope, error);
    throw error;
  });
  prepared = { scope, promise };
  controls = promise.then(() => {}, () => {});
  useIndexStore.setState({ scope, status: 'preparing', error: null });
  return promise;
}

export function ensureIndexReady(scope: IndexScope): Promise<null> {
  return prepare(scope, true, false);
}

function currentRoot(root: string): IndexScope {
  const scope = captureIndexScope();
  if (!scope || scope.root !== root) throw new Error('索引请求不属于当前启用的工作区');
  return scope;
}

export async function indexRebuild(root: string): Promise<null> {
  return prepare(currentRoot(root), true, true);
}

export async function indexSwitchVault(root: string): Promise<null> {
  return prepare(currentRoot(root), false, false);
}

function write(scope: IndexScope | null, operation: () => Promise<null>): Promise<null> {
  if (!scope || !isCurrentIndexScope(scope)) return Promise.resolve(null);
  // 先捕获当时的prepare Promise，之后的rebuild才可安全等待此写，不形成循环等待。
  const ready = ensureIndexReady(scope);
  const previous = mutations.get(scope.sessionId) ?? Promise.resolve();
  const task = Promise.allSettled([previous, ready]).then(async ([, setup]) => {
    if (setup.status === 'rejected') throw setup.reason;
    if (!isCurrentIndexScope(scope)) return null;
    await operation();
    committed(scope);
    return null;
  }).catch((error: unknown) => {
    recordIndexError(scope, error);
    throw error;
  });
  mutations.set(scope.sessionId, task.then(() => {}, () => {}));
  return task;
}

export function indexUpsertDoc(path: string, content: string, scope = captureIndexScope()): Promise<null> {
  return write(scope, () => invoke('index_upsert_doc', { ...scope!, path: path.split('\\').join('/'), content }));
}

/** 已落盘文件只传身份；原生在所属actor中读盘，真实提交后才完成此Promise。 */
export function indexRefreshFile(path: string, scope = captureIndexScope()): Promise<null> {
  if (!scope || !isCurrentIndexScope(scope)) return Promise.reject(new Error('索引工作区会话已过期或未启用'));
  return write(scope, () => invoke('index_refresh_file', { ...scope, path: path.split('\\').join('/') })).then((result) => {
    if (!isCurrentIndexScope(scope)) throw new Error('索引工作区会话已过期');
    return result;
  });
}

export function indexRemoveDoc(path: string, scope = captureIndexScope()): Promise<null> {
  return write(scope, () => invoke('index_remove_doc', { ...scope!, path: path.split('\\').join('/') }));
}

/** Close every captured preparation for this root before a worktree mutation starts. */
export async function quiesceIndexSession(root: string, captured: IndexScope | null): Promise<void> {
  const scopes = new Map<string, IndexScope>();
  if (captured?.root === root) scopes.set(captured.sessionId, captured);
  if (prepared?.scope.root === root) {
    scopes.set(prepared.scope.sessionId, prepared.scope);
    prepared = null;
  }
  for (const scope of scopes.values()) {
    retireIndexRead(scope);
    mutations.delete(scope.sessionId);
    await invoke('index_switch_vault', { ...scope, enabled: false });
  }
  await closeIndexReads();
}

let stopLifecycle: (() => void) | null = null;
export function initIndexLifecycle(): () => void {
  stopLifecycle?.();
  const sync = (): void => {
    const scope = captureIndexScope();
    if (scope) { void ensureIndexReady(scope).catch(() => {}); return; }
    if (prepared) retire(prepared.scope);
    prepared = null;
    const paused = isIndexScopePaused(useVaultStore.getState().vault) && !useSettingsStore.getState().simpleMode;
    useIndexStore.setState({ scope: null, status: paused ? 'preparing' : 'disabled', error: null });
    void closeIndexReads().catch((error) => useIndexStore.setState({ status: 'error', error: message(error) }));
  };
  const vault = useVaultStore.subscribe((next, old) => { if (next.vault !== old.vault) sync(); });
  const settings = useSettingsStore.subscribe((next, old) => { if (next.simpleMode !== old.simpleMode) sync(); });
  sync();
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    vault(); settings();
    if (prepared) retire(prepared.scope);
    prepared = null;
    resetIndexScope();
    void closeIndexReads().catch(() => {});
    if (stopLifecycle === stop) stopLifecycle = null;
  };
  stopLifecycle = stop;
  return stop;
}
