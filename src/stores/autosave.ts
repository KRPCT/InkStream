import { getDocForPath } from '../editor/editorState';
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
 * 文档真相源是 CM（state.doc.toString()）；store 永不持文档内容。默认经 getDocForPath(path)
 * 按 path 取（活动文件读 live view、非活动文件读其缓存 state，CR-01）；
 * 测试经 configureAutosave 注入 getDoc/getRoot 桩（不依赖真实 CM/vault）。
 */

const DEBOUNCE_MS = 500;

/**
 * 自激抑制窗口时长（毫秒，EDIT-06 Layer 2）。
 *
 * 原子写 = temp+rename，在 Windows 上对目标路径产出**多个** FS 事件（create temp、
 * rename、modify target…），watcher 去抖后仍可能向前端推多于一个该路径事件。原先单次
 * Set token 只吞一个 → 剩余事件泄漏进 reloadFromDisk → 组合期 setState 吞字。改为每路径
 * 到期时间戳窗口：写盘成功后该路径在窗口内的所有事件一并抑制，覆盖 rename 多事件抖动。
 */
const SUPPRESS_WINDOW_MS = 600;

/** 单调时钟（与 perf.test/blockField.test 同源，禁 Date.now 语境下安全）。 */
function now(): number {
  return performance.now();
}

/** 组合期判定：单内核 view 正在 IME 组合（jsdom 测试经 mockComposing 覆写）。 */
function isComposing(): boolean {
  return getView()?.composing === true;
}

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
    // CR-01：按 path 取真相源——活动文件读 live view，非活动文件读其缓存 state，
    // 绝不恒读当前活动 view（否则切 tab 后 A 的在途写会落 B 的内容到 A）。
    getDoc: (path) => getDocForPath(path) ?? '',
  };
}

let deps: AutosaveDeps = defaultDeps();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/**
 * 自激抑制窗口：path → 到期时间戳（performance.now 单调时钟）。写盘成功后置 now+窗口，
 * watcher 该路径事件在到期前一律被吞——覆盖 temp+rename 的多事件抖动（Layer 2，Pitfall 2）。
 */
const suppressedUntil = new Map<string, number>();
/**
 * 每 path 在途写串行链（WR-08）：scheduleAutosave 与 flushAutosave 的写都挂到同一 path 的
 * 链尾，保证 temp+rename 顺序执行，杜绝两个 rename 竞态导致旧内容覆盖新存。
 */
const inflight = new Map<string, Promise<void>>();

/** 测试注入 getDoc/getRoot 桩。 */
export function configureAutosave(next: Partial<AutosaveDeps>): void {
  deps = { ...deps, ...next };
}

function displayName(path: string): string {
  const seg = path.split(/[/\\]/);
  return seg[seg.length - 1] || path;
}

/**
 * 串行执行某 path 的落盘：先 await 该 path 的在途写（WR-08），再排到链尾。
 * 返回的 Promise 在本次写完成时解析；链上异常已被内部吞并，不会断链。
 */
function enqueueWrite(path: string): Promise<void> {
  const prev = inflight.get(path) ?? Promise.resolve();
  const next = prev.then(() => writeOnce(path));
  inflight.set(path, next);
  // 写完后若自己仍是链尾则清理（避免 Map 无界增长）。
  void next.finally(() => {
    if (inflight.get(path) === next) inflight.delete(path);
  });
  return next;
}

/** 执行一次落盘（frozen 时跳过；成功才自激抑制；失败保留脏态 + toast + 清抑制）。 */
async function writeOnce(path: string): Promise<void> {
  const { frozen, clearDirty, markDirty } = useEditorStore.getState();
  if (frozen[path]) return; // 02-04 冲突期冻结，防误覆盖
  const root = deps.getRoot();
  if (root === null) return;
  const content = deps.getDoc(path);
  // 落盘前开窗：原子写（temp+rename）紧随的多个 watcher 事件在窗口内一并被吞，不误报
  // "外部变更"（Layer 2 自激抑制）。写成功后续窗，覆盖 rename 的尾随事件抖动。
  suppressNextWatch(path);
  try {
    await writeFileAtomic(root, path, content);
    // 写成功：从落盘完成时刻起续窗，确保 rename 的尾随事件全落在窗口内被吞。
    suppressNextWatch(path);
    clearDirty(path);
  } catch {
    // WR-01：写失败时无 watcher 事件落地，必须撤回抑制窗口，否则它会吞掉
    // 下一次该路径的真实外部变更（consumeSuppressedWatch 误返 true）。
    suppressedUntil.delete(path);
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
      // Layer 3 防御纵深：定时器触发时若仍在 IME 组合期，绝不写盘——写盘会经
      // watcher→reload→setState 撕掉组合锚点（吞字）。重新武装定时器，把落盘推到
      // 组合结束之后，从源头掐断"组合期磁盘写"这条链。
      if (isComposing()) {
        scheduleAutosave(path);
        return;
      }
      void enqueueWrite(path);
    }, DEBOUNCE_MS),
  );
}

/**
 * Ctrl+S / 关 tab 前：取消防抖定时器并立即落盘。
 * WR-08：经 enqueueWrite 串到该 path 在途写链尾——若已有写在飞，先等它完成再写本次，
 * 保证落盘顺序、杜绝两个 rename 竞态。
 */
export async function flushAutosave(path: string): Promise<void> {
  const existing = timers.get(path);
  if (existing !== undefined) {
    clearTimeout(existing);
    timers.delete(path);
  }
  await enqueueWrite(path);
}

/** 冻结某文件自动保存（转发 store；02-04 仲裁接）。 */
export function freezeAutosave(path: string): void {
  useEditorStore.getState().freezeAutosave(path);
}

/**
 * 写盘前/后开抑制窗：该路径在 SUPPRESS_WINDOW_MS 内的所有 watcher 事件被忽略
 * （Layer 2 自激抑制，Pitfall 2）。区别于旧单次 token：窗口覆盖 temp+rename 的多事件抖动。
 */
export function suppressNextWatch(path: string): void {
  suppressedUntil.set(path, now() + SUPPRESS_WINDOW_MS);
}

/** watcher 收到事件时调：该路径仍在抑制窗口内则返回 true（事件被吞）；过期自动清理。 */
export function consumeSuppressedWatch(path: string): boolean {
  const until = suppressedUntil.get(path);
  if (until === undefined) return false;
  if (now() < until) return true; // 窗口内：吞掉自激事件（不消费，覆盖后续多事件）
  suppressedUntil.delete(path); // 已过期：清理并放行真实外部变更
  return false;
}

/** 复位管线（测试用）：取消所有未落盘定时器、清抑制窗、还原默认 deps。 */
export function resetAutosave(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  suppressedUntil.clear();
  inflight.clear();
  deps = defaultDeps();
}
