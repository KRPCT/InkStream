import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { setView } from './viewHandle';
import { __resetCompositionForTest, compositionGate } from './composition';
import { dispatchComposition } from '../test/composition';

/**
 * 统一冻结门单一不变量回归（重构设计 §7.2）。
 *
 * 丢弃旧 Layer-by-Layer 结构：所有组合期防护现由 composition.ts 一处的 queueAfterComposition
 * 驱动（externalChange reload / autosave write / 装饰强刷全经门），故只锁单一门不变量——
 * **组合期任一消费点零 reload / 零磁盘写；compositionend drain 后恰好执行一次；drain 顺序固定**。
 *
 * 铁律 5：jsdom 无 inputState.composing 三态 / MutationObserver，门的 observer.clear 时序、
 * setState 撕 DocView、composing===0 盲区全测不到。本套只锁副作用契约，真验收=Windows+WebView2
 * 真机 specs/03 拼音矩阵（咕咕咕 + 长句 + 英文 via IME + Enter 上屏）。
 */

const reloadFromDisk = vi.fn().mockResolvedValue(undefined);
vi.mock('./editorState', () => ({
  reloadFromDisk: (path: string) => reloadFromDisk(path),
  // getDocForPath 供 autosave 默认 deps 用（本测试不依赖其返回值）。
  getDocForPath: () => '',
}));
vi.mock('./vaultFlow', () => ({ refreshTree: vi.fn().mockResolvedValue(undefined) }));

const showToast = vi.fn();
vi.mock('../stores/useToastStore', () => ({ showToast: (...args: unknown[]) => showToast(...args) }));

import { arbitrateVaultChange } from './externalChange';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { resetAutosave, scheduleAutosave } from '../stores/autosave';
import { writeFileAtomic } from '../ipc/files';

vi.mock('../ipc/files', () => ({ writeFileAtomic: vi.fn().mockResolvedValue(null) }));

const VAULT_ROOT = '/vault';
const REL = 'note.md';
const ABS = `${VAULT_ROOT}/${REL}`;

/** 挂载真实单内核 view（含 compositionGate）：组合事件经门驱动 frozenFlags/drain，非 mock。 */
function mountView(): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc: '初始', extensions: [compositionGate] }),
    parent,
  });
  setView(view);
  return view;
}

function resetStores(): void {
  useVaultStore.setState({
    vault: { root: VAULT_ROOT, repoRoot: null, name: 'v' },
    tree: [],
    files: [],
    expanded: new Set(),
  });
  useEditorStore.setState({
    tabs: [{ path: REL, name: REL }],
    activePath: REL,
    dirty: {},
    frozen: {},
    externalChanged: {},
    cursor: 0,
    isRichtext: false,
  });
}

describe('统一冻结门：组合期零 setState/reload/write，end 后恰好一次', () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    resetAutosave();
    view = mountView();
  });

  afterEach(() => {
    __resetCompositionForTest(view);
    resetAutosave();
    view.destroy();
    setView(null);
  });

  it('外部变更：组合期不 reload，compositionend drain 后恰好一次', async () => {
    dispatchComposition(view, { phase: 'compositionstart', data: '咕' });
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    // 组合期：绝不 reloadFromDisk（不 setState 撕 DocView）。
    expect(reloadFromDisk).not.toHaveBeenCalled();

    dispatchComposition(view, { phase: 'compositionend', data: '咕咕咕' });
    await Promise.resolve();
    await Promise.resolve();
    expect(reloadFromDisk).toHaveBeenCalledTimes(1);
    expect(reloadFromDisk).toHaveBeenCalledWith(REL);
  });

  it('外部变更：组合期同一路径多个事件按 rel 去重，drain 仅重放一次', async () => {
    dispatchComposition(view, { phase: 'compositionstart', data: '长' });
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    expect(reloadFromDisk).not.toHaveBeenCalled();

    dispatchComposition(view, { phase: 'compositionend', data: '长句' });
    await Promise.resolve();
    await Promise.resolve();
    expect(reloadFromDisk).toHaveBeenCalledTimes(1);
  });

  it('外部变更：非组合期照常立即 reload', async () => {
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    expect(reloadFromDisk).toHaveBeenCalledTimes(1);
    expect(reloadFromDisk).toHaveBeenCalledWith(REL);
  });

  it('Toast 不撒谎：组合期排队时不弹，drain 后弹一次', async () => {
    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    // 组合期排队：reload 未跑，Toast 必不弹（否则「已自动重载」撒谎）。
    expect(showToast).not.toHaveBeenCalled();

    dispatchComposition(view, { phase: 'compositionend', data: '你好' });
    await Promise.resolve();
    await Promise.resolve();
    expect(reloadFromDisk).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('warning', expect.stringContaining('已自动重载'));
  });

  it('autosave：组合期定时器到期不写盘、排队；compositionend drain 后写一次', async () => {
    vi.useFakeTimers();
    try {
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      scheduleAutosave(REL);
      // 定时器到期（500ms）：组合期 → 不写盘，按 autosave:path 去重挂起（消除旧 500ms 轮询自旋）。
      await vi.advanceTimersByTimeAsync(600);
      expect(writeFileAtomic).not.toHaveBeenCalled();

      // 组合结束 drain → 写一次。
      dispatchComposition(view, { phase: 'compositionend', data: '你好' });
      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(writeFileAtomic).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('autosave：组合期多次定时器到期按 path 去重，drain 后仍只写一次', async () => {
    vi.useFakeTimers();
    try {
      dispatchComposition(view, { phase: 'compositionstart', data: '你' });
      scheduleAutosave(REL);
      await vi.advanceTimersByTimeAsync(600);
      scheduleAutosave(REL);
      await vi.advanceTimersByTimeAsync(600);
      expect(writeFileAtomic).not.toHaveBeenCalled();

      dispatchComposition(view, { phase: 'compositionend', data: '你好' });
      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(writeFileAtomic).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drain 固定顺序：refreshLivePreview 强刷 → reload（排队任务）', async () => {
    const seq: string[] = [];
    reloadFromDisk.mockImplementation(() => {
      seq.push('reload');
      return Promise.resolve();
    });
    const spy = vi.spyOn(view, 'dispatch').mockImplementation((() => {
      // 门 drain 派发 refreshLivePreview 强刷：记入顺序（不真正 update，避免触发其它副作用）。
      seq.push('refresh');
    }) as never);

    dispatchComposition(view, { phase: 'compositionstart', data: '你' });
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    dispatchComposition(view, { phase: 'compositionend', data: '你好' });

    await Promise.resolve();
    await Promise.resolve();
    // 强刷必先于排队的 reload（解冻还原渲染态在前，副作用在后）。
    expect(seq).toEqual(['refresh', 'reload']);
    spy.mockRestore();
  });
});
