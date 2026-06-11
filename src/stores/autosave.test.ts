import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { writeFileAtomic } from '../ipc/files';
import { useToastStore } from './useToastStore';
import { useEditorStore } from './useEditorStore';
import {
  AUTOSAVE_ERROR_PREFIX,
  configureAutosave,
  consumeSuppressedWatch,
  flushAutosave,
  resetAutosave,
  scheduleAutosave,
  suppressNextWatch,
} from './autosave';

vi.mock('../ipc/files', () => ({
  writeFileAtomic: vi.fn().mockResolvedValue(null),
}));

const mockWrite = writeFileAtomic as Mock;

/** 当前文档内容桩（按 path 返回，模拟 CM view.state.doc）。 */
let docs: Record<string, string>;

function resetEditor(): void {
  useEditorStore.setState({ tabs: [], activePath: null, dirty: {}, cursor: 0, frozen: {} });
}

describe('autosave 防抖落盘管线', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockWrite.mockResolvedValue(null);
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

  it('frozen 时不落盘（02-04 冲突期防误覆盖）', async () => {
    useEditorStore.getState().freezeAutosave('a.md');
    docs['a.md'] = '冻结期编辑';
    scheduleAutosave('a.md');
    await vi.runAllTimersAsync();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('suppressNextWatch 后该路径下一个 watcher 事件被吞（自激抑制）', () => {
    suppressNextWatch('a.md');
    // 第一次消费返回 true（吞掉自激事件）
    expect(consumeSuppressedWatch('a.md')).toBe(true);
    // 第二次返回 false（只吞一个）
    expect(consumeSuppressedWatch('a.md')).toBe(false);
    // 未抑制的路径直接 false
    expect(consumeSuppressedWatch('b.md')).toBe(false);
  });

  it('落盘前自动 suppressNextWatch 该路径（原子写不触发自身 watcher 误判）', async () => {
    docs['a.md'] = '自动保存';
    scheduleAutosave('a.md');
    await vi.runAllTimersAsync();
    // 落盘后紧跟的 watcher 事件应被自激抑制吞掉
    expect(consumeSuppressedWatch('a.md')).toBe(true);
  });
});
