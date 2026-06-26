import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { writeFileAtomic, writeFileToPath } from '../ipc/files';
import { useToastStore } from './useToastStore';
import { useEditorStore } from './useEditorStore';
import {
  AUTOSAVE_ERROR_PREFIX,
  cancelPendingAutosave,
  configureAutosave,
  consumeSuppressedWatch,
  flushAutosave,
  resetAutosave,
  resumeAutosave,
  scheduleAutosave,
  suppressNextWatch,
  suspendAutosave,
  writeProjectFile,
} from './autosave';

vi.mock('../ipc/files', () => ({
  writeFileAtomic: vi.fn().mockResolvedValue(null),
  writeFileToPath: vi.fn().mockResolvedValue(null),
}));

const mockWrite = writeFileAtomic as Mock;
const mockWriteAbs = writeFileToPath as Mock;

/** 当前文档内容桩（按 path 返回，模拟 CM view.state.doc）。 */
let docs: Record<string, string>;

/** 排空一批微任务（链式 .then 跨多个微任务回合需多次让步）。 */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function resetEditor(): void {
  useEditorStore.setState({ tabs: [], activePath: null, dirty: {}, cursor: 0, frozen: {} });
}

describe('autosave 防抖落盘管线', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockWrite.mockResolvedValue(null);
    mockWriteAbs.mockResolvedValue(null);
    docs = { 'a.md': '初始' };
    resetEditor();
    resetAutosave();
    configureAutosave({
      getRoot: () => '/vault',
      getDoc: (path) => docs[path] ?? '',
    });
    useEditorStore.getState().openTab({ path: 'a.md', name: 'a.md' });
    useEditorStore.getState().setActive('a.md');
  });

  afterEach(() => {
    resetAutosave();
    vi.useRealTimers();
  });

  it('防抖窗口内多次编辑只 writeFileAtomic 一次', async () => {
    docs['a.md'] = 'e1';
    scheduleAutosave('a.md');
    docs['a.md'] = 'e2';
    scheduleAutosave('a.md');
    docs['a.md'] = 'e3';
    scheduleAutosave('a.md');
    expect(mockWrite).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(mockWrite).toHaveBeenCalledTimes(1);
    // 落盘的是最后一次内容
    expect(mockWrite).toHaveBeenCalledWith('/vault', 'a.md', 'e3');
  });

  it('落盘成功清 dirty', async () => {
    useEditorStore.getState().markDirty('a.md');
    docs['a.md'] = '已改';
    scheduleAutosave('a.md');
    await vi.runAllTimersAsync();
    expect(useEditorStore.getState().dirty['a.md']).toBe(false);
  });

  it('落盘失败保留 dirty 不清脏标记 + 错误 toast', async () => {
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    // 监听 showToast：fake timer 下 6s 自动消失定时器会在 runAllTimersAsync 内清空
    // toasts 数组，故以 spy 捕获调用而非读残留状态。
    const toastSpy = vi.spyOn(useToastStore.getState(), 'showToast');
    useEditorStore.getState().markDirty('a.md');
    docs['a.md'] = '改了但写失败';
    scheduleAutosave('a.md');
    await vi.runAllTimersAsync();
    // dirty 保留（不清脏标记）
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
    // 错误 toast 含文件名
    expect(toastSpy).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('a.md'),
    );
    expect(toastSpy).toHaveBeenCalledWith(
      'error',
      expect.stringContaining(AUTOSAVE_ERROR_PREFIX),
    );
  });

  it('flushAutosave 立即落盘（取消防抖定时器）', async () => {
    docs['a.md'] = 'ctrl-s';
    scheduleAutosave('a.md');
    // 不推进定时器，直接 flush
    await flushAutosave('a.md');
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite).toHaveBeenCalledWith('/vault', 'a.md', 'ctrl-s');
    // flush 后再跑定时器不应二次落盘（定时器已取消）
    await vi.runAllTimersAsync();
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('草稿 path（draft://）schedule 与 flush 均跳过落盘（无真实路径）', async () => {
    docs['draft://1'] = '草稿内容';
    scheduleAutosave('draft://1');
    await vi.runAllTimersAsync();
    await flushAutosave('draft://1');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('frozen 时不落盘（02-04 冲突期防误覆盖）', async () => {
    useEditorStore.getState().freezeAutosave('a.md');
    docs['a.md'] = '冻结期编辑';
    scheduleAutosave('a.md');
    await vi.runAllTimersAsync();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('suppressNextWatch 后窗口内该路径事件被吞、未抑制路径不吞（Layer 2 窗口自激抑制）', () => {
    suppressNextWatch('a.md');
    // 窗口内多次消费均返回 true（覆盖 temp+rename 的多事件抖动，区别于旧单次 token）
    expect(consumeSuppressedWatch('a.md')).toBe(true);
    expect(consumeSuppressedWatch('a.md')).toBe(true);
    // 未抑制的路径直接 false
    expect(consumeSuppressedWatch('b.md')).toBe(false);
  });

  it('抑制窗口到期后真实外部变更不再被吞（窗口过期放行 + 清理）', () => {
    suppressNextWatch('a.md');
    expect(consumeSuppressedWatch('a.md')).toBe(true);
    // 推进超过抑制窗口（fake timers 同步推进 performance.now）
    vi.advanceTimersByTime(700);
    // 过期：放行真实外部变更（D-04 不漏外部修改）
    expect(consumeSuppressedWatch('a.md')).toBe(false);
  });

  it('落盘前自动 suppressNextWatch 该路径（原子写不触发自身 watcher 误判）', async () => {
    docs['a.md'] = '自动保存';
    scheduleAutosave('a.md');
    await vi.runAllTimersAsync();
    // 落盘后紧跟的 watcher 事件应被自激抑制吞掉
    expect(consumeSuppressedWatch('a.md')).toBe(true);
  });

  it('WR-01：写失败后抑制 token 被清，下一个真实外部变更不被吞', async () => {
    mockWrite.mockRejectedValueOnce(new Error('disk full'));
    docs['a.md'] = '写失败';
    scheduleAutosave('a.md');
    await vi.runAllTimersAsync();
    // 写失败 → 无 watcher 事件落地 → 抑制 token 必须已撤回。
    // 否则下一个该路径的真实外部变更会被 consumeSuppressedWatch 误吞（违反 D-04）。
    expect(consumeSuppressedWatch('a.md')).toBe(false);
  });

  it('WR-08：在途防抖写未落盘时 flush，两次写不并发、按序串行（后写者最后赢）', async () => {
    // 用可控 resolve 的写桩模拟"温度计"：start 记录开始、end 等外部 resolve。
    const started: string[] = [];
    const ended: string[] = [];
    const resolvers: Array<() => void> = [];
    mockWrite.mockImplementation((_root: string, _path: string, content: string) => {
      started.push(content);
      return new Promise<null>((resolve) => {
        resolvers.push(() => {
          ended.push(content);
          resolve(null);
        });
      });
    });

    // 1) 防抖定时器触发 → enqueueWrite 开始写 v1（in-flight，未 resolve）。
    docs['a.md'] = 'v1';
    scheduleAutosave('a.md');
    await vi.advanceTimersByTimeAsync(500); // 定时器触发，writeOnce(v1) 进入 await
    expect(started).toEqual(['v1']); // v1 已开始

    // 2) v1 仍在飞时调 flush（内容 v2）：串行化要求 v2 不得在 v1 解析前开始。
    docs['a.md'] = 'v2';
    const flushed = flushAutosave('a.md');
    await drainMicrotasks();
    // 关键断言：v2 绝不能在 v1 落盘完成前开始（否则两 rename 并发竞态）。
    expect(started).toEqual(['v1']);

    // 3) 放行 v1 → v2 才开始。
    resolvers[0]();
    await drainMicrotasks();
    expect(started).toEqual(['v1', 'v2']);
    resolvers[1]();
    await flushed;
    // 落盘顺序严格 v1→v2，最后存的是 v2（后写者赢，无旧覆盖新）。
    expect(ended).toEqual(['v1', 'v2']);
  });

  it('库外 tab：经 writeFileToPath 绝对写，不走 writeFileAtomic（#5 external）', async () => {
    useEditorStore.getState().openTab({ path: 'D:/other/ext.md', name: 'ext.md', external: true });
    useEditorStore.getState().setActive('D:/other/ext.md');
    docs['D:/other/ext.md'] = '库外内容';
    scheduleAutosave('D:/other/ext.md');
    await vi.runAllTimersAsync();
    expect(mockWriteAbs).toHaveBeenCalledWith('D:/other/ext.md', '库外内容');
    // 绝不把库外 path 当相对路径拼到 vault 根（那正是 #3 覆盖新库文件的元凶）。
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('suspendAutosave 期间一律不落盘（#3 切库防误写），resume 后恢复', async () => {
    docs['a.md'] = '挂起期编辑';
    suspendAutosave();
    scheduleAutosave('a.md');
    await vi.runAllTimersAsync();
    expect(mockWrite).not.toHaveBeenCalled();
    resumeAutosave();
    docs['a.md'] = '恢复后';
    scheduleAutosave('a.md');
    await vi.runAllTimersAsync();
    expect(mockWrite).toHaveBeenCalledWith('/vault', 'a.md', '恢复后');
  });

  it('cancelPendingAutosave 取消未落盘的防抖定时器（切库前清场）', async () => {
    docs['a.md'] = '待写';
    scheduleAutosave('a.md');
    cancelPendingAutosave();
    await vi.runAllTimersAsync();
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe('writeProjectFile（#2c 未打开文件直写显式内容）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWrite.mockResolvedValue(null);
    resetAutosave();
    configureAutosave({ getRoot: () => '/vault', getDoc: () => '' });
  });

  afterEach(() => resetAutosave());

  it('原子写显式内容（不经 getDoc，杜绝按 null 写空），返回 true', async () => {
    const ok = await writeProjectFile('notes/x.md', '替换后的内容');
    expect(ok).toBe(true);
    expect(mockWrite).toHaveBeenCalledWith('/vault', 'notes/x.md', '替换后的内容');
  });

  it('写成功后自激抑制该路径 watcher 事件', async () => {
    await writeProjectFile('notes/x.md', '内容');
    expect(consumeSuppressedWatch('notes/x.md')).toBe(true);
  });

  it('写失败返回 false 且撤回抑制窗（不吞后续真实外部变更）', async () => {
    mockWrite.mockRejectedValueOnce(new Error('EACCES'));
    expect(await writeProjectFile('notes/x.md', '内容')).toBe(false);
    expect(consumeSuppressedWatch('notes/x.md')).toBe(false);
  });

  it('无 vault 根：不写，返回 false', async () => {
    configureAutosave({ getRoot: () => null });
    expect(await writeProjectFile('x.md', 'c')).toBe(false);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
