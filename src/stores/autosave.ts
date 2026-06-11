import { getView } from '../editor/viewHandle';
import { writeFileAtomic } from '../ipc/files';
import { useEditorStore } from './useEditorStore';
import { useToastStore } from './useToastStore';
import { useVaultStore } from './useVaultStore';

/**
 * 编辑防抖落盘管线（D-02 / FILE-01）。照 persistSettings 500ms 防抖范式。
 *
 * - scheduleAutosave：docChanged 触发，防抖窗口内多次编辑合并为一次原子写。
 * - flushAutosave：Ctrl+S / 关 tab 前立即落盘（取消防抖定时器）。
 * - frozen（02-04 冲突期）时跳过落盘，防误覆盖外部变更。
 * - 落盘前 suppressNextWatch：自己的原子写不触发自身 watcher 误判（Pitfall 2 自激抑制）。
 * - 落盘失败保留 dirty + 错误 toast，绝不清脏标记（UI-SPEC 错误态）。
 *
 * 文档真相源是 CM view（state.doc.toString()）；store 永不持文档内容。默认经 getView() 读 doc，
 * 测试经 configureAutosave 注入 getDoc/getRoot 桩（不依赖真实 CM/vault）。
 */

const DEBOUNCE_MS = 500;

export const AUTOSAVE_ERROR_PREFIX = '「';
const errorMessage = (name: string): string =>
  `${AUTOSAVE_ERROR_PREFIX}${name}」保存失败，你的修改仍保留在编辑器中。`;

interface AutosaveDeps {
  /** 读 vault 根绝对路径（默认自 useVaultStore）。 */
  getRoot: () => string | null;
  /** 读某 path 当前文档内容（默认自单内核 view.state.doc）。 */
  getDoc: (path: string) => string;
}

function defaultDeps(): AutosaveDeps {
  return {
    getRoot: () => useVaultStore.getState().vault?.root ?? null,
    getDoc: () => getView()?.state.doc.toString() ?? '',
  };
}

let deps: AutosaveDeps = defaultDeps();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** 自激抑制集合：写盘前置入，watcher 下一个该路径事件消费一次即清（Pitfall 2）。 */
const suppressed = new Set<string>();

/** 测试注入 getDoc/getRoot 桩。 */
export function configureAutosave(next: Partial<AutosaveDeps>): void {
  deps = { ...deps, ...next };
}

function displayName(path: string): string {
  const seg = path.split(/[/\\]/);
  return seg[seg.length - 1] || path;
}

/** 执行一次落盘（frozen 时跳过；落盘前自激抑制；失败保留脏态 + toast）。 */
async function writeNow(path: string): Promise<void> {
  const { frozen, clearDirty, markDirty } = useEditorStore.getState();
  if (frozen[path]) return; // 02-04 冲突期冻结，防误覆盖
  const root = deps.getRoot();
  if (root === null) return;
  const content = deps.getDoc(path);
  // 落盘前标记：原子写紧随的 watcher 事件被吞，不误报"外部变更"（自激抑制）
  suppressNextWatch(path);
  try {
    await writeFileAtomic(root, path, content);
    clearDirty(path);
  } catch {
    // 落盘失败：保留脏态（不清脏标记）+ 错误 toast，不关 tab（UI-SPEC 错误态）
    markDirty(path);
    useToastStore.getState().showToast('error', errorMessage(displayName(path)));
  }
}

/** 编辑触发：防抖窗口内多次调用合并为一次落盘。 */
export function scheduleAutosave(path: string): void {
  const existing = timers.get(path);
  if (existing !== undefined) clearTimeout(existing);
  timers.set(
    path,
    setTimeout(() => {
      timers.delete(path);
      void writeNow(path);
    }, DEBOUNCE_MS),
  );
}

/** Ctrl+S / 关 tab 前：取消防抖定时器并立即落盘。 */
export async function flushAutosave(path: string): Promise<void> {
  const existing = timers.get(path);
  if (existing !== undefined) {
    clearTimeout(existing);
    timers.delete(path);
  }
  await writeNow(path);
}

/** 冻结某文件自动保存（转发 store；02-04 仲裁接）。 */
export function freezeAutosave(path: string): void {
  useEditorStore.getState().freezeAutosave(path);
}

/** 写盘前标记：watcher 该路径下一个事件被忽略（自激抑制，Pitfall 2）。 */
export function suppressNextWatch(path: string): void {
  suppressed.add(path);
}

/** watcher 收到事件时调：该路径处于抑制态则消费一次返回 true（事件被吞）。 */
export function consumeSuppressedWatch(path: string): boolean {
  if (suppressed.has(path)) {
    suppressed.delete(path);
    return true;
  }
  return false;
}

/** 复位管线（测试用）：取消所有未落盘定时器、清抑制集合、还原默认 deps。 */
export function resetAutosave(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  suppressed.clear();
  deps = defaultDeps();
}
