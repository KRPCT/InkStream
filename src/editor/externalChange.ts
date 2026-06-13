import { onVaultChange, type UnlistenFn, type VaultChangePayload } from '../ipc/events';
import { readFile } from '../ipc/files';
import { indexRemoveDoc, indexUpsertDoc, isIndexable } from '../ipc/indexService';
import { consumeSuppressedWatch, freezeAutosave } from '../stores/autosave';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { isComposing, queueAfterComposition } from './composition';
import { reloadFromDisk } from './editorState';
import { getView } from './viewHandle';
import { refreshTree } from './fileTreeData';

/**
 * 外部变更冲突仲裁（FILE-02 / D-04 双路径）。
 *
 * watcher（02-03）经 onVaultChange 推送 vault 内变更绝对路径，本模块按**该 path 自身**是否打开/脏分三路
 * （CR-03：按 per-path 脏标记仲裁，而非 active-vs-not，否则后台脏 tab 被静默覆盖）：
 * - 任意打开 tab（活动或后台）且脏 → freezeAutosave + 标记 externalChanged，切回该 tab 时 ExternalChangeBar 显式仲裁
 * - 当前活动文件且干净 → 静默重载磁盘 + Toast（D-04 干净路径）
 * - 其余（非打开文件 / 干净的后台文件）→ 刷新文件树（受控 data，与写操作同一刷新入口）
 *
 * 自激抑制：自身原子写紧随的 watcher 事件被 consumeSuppressedWatch 吞，绝不误弹提示条（Pitfall 2）。
 */

/** 绝对变更路径 → 相对 vault 根路径（不在 vault 内返回 null）。统一 `/` 分隔。 */
function toRelative(root: string, abs: string): string | null {
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normAbs = abs.replace(/\\/g, '/');
  if (normAbs === normRoot) return '';
  const prefix = `${normRoot}/`;
  if (!normAbs.startsWith(prefix)) return null;
  return normAbs.slice(prefix.length);
}

/** 取文件名（末段）。 */
function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/**
 * 外部变更后同步 FTS5 索引（Phase 4 W1，仅挂实际反映磁盘新态的分支：reload 成功 / refreshTree，
 * **绝不挂 freeze 分支**——freeze 时磁盘新内容尚未被采纳，索引留旧待用户裁决重载后由后续路径补齐）。
 * remove → 删索引；create/modify → 读盘 upsert（仅 .md，与 rebuild 一致）。fire-and-forget 不阻断仲裁。
 */
function reindexExternal(root: string, rel: string, kind: string): void {
  if (!isIndexable(rel)) return;
  try {
    if (kind === 'remove') {
      void indexRemoveDoc(rel).catch(() => {});
      return;
    }
    void readFile(root, rel)
      .then((content) => indexUpsertDoc(rel, content))
      .catch(() => {}); // 文件已删/读失败：忽略（下次变更或重建补齐）。
  } catch {
    // 索引/读盘依赖不可用：彻底吞掉，绝不抛进仲裁流程（fire-and-forget，doc 真相源不受影响）。
  }
}

/** 单次仲裁（导出供测试直接驱动；订阅回调内部调用）。 */
export async function arbitrateVaultChange(payload: VaultChangePayload): Promise<void> {
  const vault = useVaultStore.getState().vault;
  if (!vault) return;
  const rel = toRelative(vault.root, payload.path);
  if (rel === null || rel === '') return;

  // 自激抑制：自己原子写触发的事件被吞一次，不进入任何仲裁分支
  if (consumeSuppressedWatch(rel)) return;

  const { activePath, dirty, tabs } = useEditorStore.getState();
  const isOpen = tabs.some((t) => t.path === rel);

  // 任意打开 tab（活动或后台）且脏：冻结 + 标记冲突，绝不静默覆盖（CR-03 / D-04 / FILE-02）。
  // 后台脏 tab 的冲突在切回该 tab 时由 ExternalChangeBar 呈现（它按 activePath 渲染）。
  if (isOpen && dirty[rel]) {
    freezeAutosave(rel);
    useEditorStore.getState().markExternalChange(rel);
    return;
  }

  // 当前活动文件且干净：静默重载 + 轻提示（D-04 干净路径）。
  if (rel === activePath) {
    // 组合期绝不 reloadFromDisk——它经 openFile→view.setState() 撕掉 IME 锚定的 DocView（吞字，铁律 2）。
    // 统一冻结门收口：组合期按 rel 去重排队（同 path 多 watcher 事件只重放一次），compositionend
    // drain 后执行整条仲裁。Toast 不撒谎——「已自动重载」在 task 体内 reload 实际成功后才弹。
    const view = getView();
    if (view && isComposing(view)) {
      queueAfterComposition(view, rel, () => arbitrateVaultChange(payload));
      return;
    }
    try {
      await reloadFromDisk(rel);
      showToast('warning', `「${baseName(rel)}」已在外部被修改，已自动重载。`);
    } catch {
      showToast('error', `「${baseName(rel)}」外部变更后重载失败，请手动重新打开。`);
      return;
    }
    // 重载成功后同步索引（移出 try——索引失败绝不触发上面的「重载失败」error toast）。
    reindexExternal(vault.root, rel, payload.kind);
    return;
  }

  // 其余（非打开文件 / 干净的后台文件）：仅刷新文件树。
  // 干净的后台文件无需重载——下次打开自然读最新盘（reloadFromDisk 仅对活动文件换装）。
  await refreshTree();
  reindexExternal(vault.root, rel, payload.kind); // 反映磁盘新态：新增/改/删的非活动 .md 同步索引。
}

let unlisten: UnlistenFn | null = null;
/**
 * 订阅代际令牌（WR-07）：每次 init/stop 自增。订阅 Promise 解析时若 generation 已变（被
 * 后续 stop/init 取消），立即解掉刚拿到的 unlisten，绝不存为当前订阅——杜绝快速切 vault 时
 * 已解析的 unlisten 泄漏或误拆新订阅。
 */
let generation = 0;

/** 启动外部变更仲裁订阅（切入 vault / App 启动时调）。幂等：重复调用先解订阅。 */
export function initExternalChangeArbiter(): void {
  stopExternalChangeArbiter();
  const myGen = generation;
  void onVaultChange((payload) => {
    void arbitrateVaultChange(payload);
  }).then((fn) => {
    if (generation !== myGen) {
      // 本次订阅在解析前已被取消（stop 或又一次 init）：直接解掉，不泄漏、不覆盖。
      fn();
      return;
    }
    unlisten = fn;
  });
}

/** 解订阅（切出 vault / 测试复位）。自增代际令牌，使在途订阅解析后自解。 */
export function stopExternalChangeArbiter(): void {
  generation += 1;
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}
