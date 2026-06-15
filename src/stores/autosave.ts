import { queueAfterComposition } from '../editor/composition';
import { isDraftPath } from '../editor/draftPath';
import { getDocForPath } from '../editor/editorState';
import { getView } from '../editor/viewHandle';
import { writeFileAtomic, writeFileToPath } from '../ipc/files';
import { indexUpsertDoc, isIndexable } from '../ipc/indexService';
import { useEditorStore } from './useEditorStore';
import { useSettingsStore } from './useSettingsStore';
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

/**
 * 切库挂起标志：suspendAutosave 后 writeOnce 一律早返回，杜绝旧 tab 的排队/在途写在切库瞬间
 * 落到刚切入的新库（#3 数据丢失根因——旧相对路径 + 新库根 = 覆盖新库同名文件）。
 * 配合 cancelPendingAutosave 清防抖定时器；rehome 重归位完成后 resumeAutosave。
 */
let suspended = false;
export function suspendAutosave(): void {
  suspended = true;
}
export function resumeAutosave(): void {
  suspended = false;
}
/** 取消所有未落盘的防抖定时器（切库前调）。已在飞的写不动——它们已捕获旧库根、写对位置。 */
export function cancelPendingAutosave(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
}

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

/** 执行一次落盘（suspend/frozen 时跳过；成功才自激抑制；失败保留脏态 + toast + 清抑制）。 */
async function writeOnce(path: string): Promise<void> {
  if (suspended) return; // 切库期间一律不落盘——防旧 tab 的排队/在途写落到新库（#3 数据丢失）。
  const { frozen, clearDirty, markDirty, tabs } = useEditorStore.getState();
  if (frozen[path]) return; // 02-04 冲突期冻结，防误覆盖
  // 库外（非工作区）文件：path 即绝对路径，写其真实位置；库内文件：vault 根 + 相对 path。
  const external = tabs.find((t) => t.path === path)?.external === true;
  const root = external ? null : deps.getRoot();
  if (!external && root === null) return; // 库内文件无 vault 根不落盘
  const content = deps.getDoc(path);
  // 落盘前开窗：原子写（temp+rename）紧随的多个 watcher 事件在窗口内一并被吞，不误报
  // "外部变更"（Layer 2 自激抑制）。写成功后续窗，覆盖 rename 的尾随事件抖动。
  suppressNextWatch(path);
  try {
    if (external) {
      await writeFileToPath(path, content); // 库外：绝对原子写（不经 vault path_guard，同草稿另存为）。
    } else {
      await writeFileAtomic(root as string, path, content); // 库内：vault 根 + 相对 path。
    }
    // 写成功：从落盘完成时刻起续窗，确保 rename 的尾随事件全落在窗口内被吞。
    suppressNextWatch(path);
    clearDirty(path);
    // Phase 4 W1：库内 .md 写盘成功后增量更新 FTS5 索引（autosave 主路径，已有内存内容无需读盘）。
    // 库外文件不属当前 vault、不入索引。fire-and-forget——索引投递失败绝不阻断/回滚保存。
    if (!external && isIndexable(path)) void indexUpsertDoc(path, content).catch(() => {});
  } catch {
    // WR-01：写失败时无 watcher 事件落地，必须撤回抑制窗口，否则它会吞掉
    // 下一次该路径的真实外部变更（consumeSuppressedWatch 误返 true）。
    suppressedUntil.delete(path);
    // 落盘失败：保留脏态（不清脏标记）+ 错误 toast，不关 tab（UI-SPEC 错误态）
    markDirty(path);
    useToastStore.getState().showToast('error', errorMessage(displayName(path)));
  }
}

/** 编辑触发：防抖窗口内多次调用合并为一次落盘。草稿（draft://）无真实路径，一律跳过。 */
export function scheduleAutosave(path: string): void {
  if (isDraftPath(path)) return;
  // 簇②：自动保存关闭则不调度——编辑已由 mirrorListener 先 markDirty（脏标记仍显），用户 Ctrl+S 手动落盘。
  if (!useSettingsStore.getState().autosaveEnabled) return;
  const existing = timers.get(path);
  if (existing !== undefined) clearTimeout(existing);
  timers.set(
    path,
    setTimeout(() => {
      timers.delete(path);
      // 组合期磁盘写经 watcher→reload→setState 撕掉组合锚点（吞字，铁律 2）。统一冻结门收口：
      // 非组合期立即 enqueueWrite（行为同今天非组合路径）；组合期按 path 去重挂起，compositionend
      // drain 写一次——消除旧 Layer 3 的 500ms 轮询自旋，组合结束即落盘。
      const view = getView();
      if (view) queueAfterComposition(view, 'autosave:' + path, () => enqueueWrite(path));
      else void enqueueWrite(path); // 无 view（测试/未挂载）直接写
    }, useSettingsStore.getState().autosaveDelayMs),
  );
}

/**
 * Ctrl+S / 关 tab 前：取消防抖定时器并立即落盘。
 * WR-08：经 enqueueWrite 串到该 path 在途写链尾——若已有写在飞，先等它完成再写本次，
 * 保证落盘顺序、杜绝两个 rename 竞态。草稿（draft://）一律跳过（保存走 saveDraftAs）。
 */
export async function flushAutosave(path: string): Promise<void> {
  if (isDraftPath(path)) return;
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
  suspended = false;
  deps = defaultDeps();
}
