import { onVaultChange, type UnlistenFn, type VaultChangePayload } from '../ipc/events';
import { consumeSuppressedWatch, freezeAutosave } from '../stores/autosave';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { reloadFromDisk } from './editorState';
import { refreshTree } from './vaultFlow';

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
    try {
      await reloadFromDisk(rel);
      showToast('warning', `「${baseName(rel)}」已在外部被修改，已自动重载。`);
    } catch {
      showToast('error', `「${baseName(rel)}」外部变更后重载失败，请手动重新打开。`);
    }
    return;
  }

  // 其余（非打开文件 / 干净的后台文件）：仅刷新文件树。
  // 干净的后台文件无需重载——下次打开自然读最新盘（reloadFromDisk 仅对活动文件换装）。
  await refreshTree();
}

let unlisten: UnlistenFn | null = null;
let pending: Promise<void> | null = null;

/** 启动外部变更仲裁订阅（切入 vault / App 启动时调）。幂等：重复调用先解订阅。 */
export function initExternalChangeArbiter(): void {
  stopExternalChangeArbiter();
  pending = onVaultChange((payload) => {
    void arbitrateVaultChange(payload);
  }).then((fn) => {
    unlisten = fn;
  });
}

/** 解订阅（切出 vault / 测试复位）。 */
export function stopExternalChangeArbiter(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  void pending?.then((): void => {
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  });
  pending = null;
}
