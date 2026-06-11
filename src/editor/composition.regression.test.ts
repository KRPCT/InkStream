import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { setView } from './viewHandle';
import { dispatchComposition, mockComposing } from '../test/composition';

/**
 * EDIT-06 吞字根因回归：组合期绝不 setState/reload/write，结束后恰好重放一次。
 *
 * 锁定的契约（jsdom 无法复现真实 IME，故只锁"组合期无 setState/reload/write"这条不变量；
 * 真验收是手动 Windows+WebView2 拼音：咕咕咕 + 长句 + 英文 via IME + Enter 上屏）：
 *   - Layer 1：活动文件干净外部变更，组合期 → 不 reloadFromDisk，挂一次性 compositionend；
 *     组合结束后重放仲裁，reload 恰好一次（genuine 外部编辑不丢）。
 *   - Layer 1：非组合期活动文件外部变更 → 照常立即 reload。
 *   - Layer 2：自激抑制窗口吞掉一次自身写的多个重复事件。
 *   - Layer 3：armed autosave 定时器组合期触发 → 重新武装而非写盘。
 */

const reloadFromDisk = vi.fn().mockResolvedValue(undefined);
vi.mock('./editorState', () => ({
  reloadFromDisk: (path: string) => reloadFromDisk(path),
  // getDocForPath 供 autosave 默认 deps 用（本测试不依赖其返回值）。
  getDocForPath: () => '',
}));
vi.mock('./vaultFlow', () => ({ refreshTree: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../stores/useToastStore', () => ({ showToast: vi.fn() }));

import { arbitrateVaultChange, __clearPendingReplayForTest } from './externalChange';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import {
  consumeSuppressedWatch,
  resetAutosave,
  scheduleAutosave,
  suppressNextWatch,
} from '../stores/autosave';
import { writeFileAtomic } from '../ipc/files';

vi.mock('../ipc/files', () => ({ writeFileAtomic: vi.fn().mockResolvedValue(null) }));

const VAULT_ROOT = '/vault';
const REL = 'note.md';
const ABS = `${VAULT_ROOT}/${REL}`;

function mountView(): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc: '初始' }),
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

describe('EDIT-06 组合期不 setState/reload/write 回归', () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    resetAutosave();
    __clearPendingReplayForTest();
    view = mountView();
  });

  afterEach(() => {
    resetAutosave();
    __clearPendingReplayForTest();
    view.destroy();
    setView(null);
  });

  it('Layer 1：组合期活动文件外部变更不 reload，compositionend 后恰好重放一次', async () => {
    mockComposing(view, true);
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    // 组合期：绝不 reloadFromDisk（不 setState 撕 DocView）
    expect(reloadFromDisk).not.toHaveBeenCalled();

    // 组合结束 → 重放仲裁，此时 setState 安全
    mockComposing(view, false);
    dispatchComposition(view, { phase: 'compositionend', data: '咕咕咕' });
    await Promise.resolve();
    await Promise.resolve();
    expect(reloadFromDisk).toHaveBeenCalledTimes(1);
    expect(reloadFromDisk).toHaveBeenCalledWith(REL);
  });

  it('Layer 1：组合期同一路径多个事件只挂一个 handler，结束仅重放一次', async () => {
    mockComposing(view, true);
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    expect(reloadFromDisk).not.toHaveBeenCalled();

    mockComposing(view, false);
    dispatchComposition(view, { phase: 'compositionend', data: '长句' });
    await Promise.resolve();
    await Promise.resolve();
    // 去重：只重放一次（不是三次）
    expect(reloadFromDisk).toHaveBeenCalledTimes(1);
  });

  it('Layer 1：非组合期活动文件外部变更照常立即 reload', async () => {
    mockComposing(view, false);
    await arbitrateVaultChange({ path: ABS, kind: 'modify' });
    expect(reloadFromDisk).toHaveBeenCalledTimes(1);
    expect(reloadFromDisk).toHaveBeenCalledWith(REL);
  });

  it('Layer 2：自激抑制窗口吞掉自身写的重复事件（temp+rename 多事件）', () => {
    suppressNextWatch(REL);
    // 窗口内多个该路径事件全被吞（旧单 token 只能吞一个）
    expect(consumeSuppressedWatch(REL)).toBe(true);
    expect(consumeSuppressedWatch(REL)).toBe(true);
  });

  it('Layer 3：armed autosave 定时器组合期触发 → 重新武装而非写盘', async () => {
    vi.useFakeTimers();
    try {
      mockComposing(view, true);
      scheduleAutosave(REL);
      // 定时器触发（500ms）：组合期 → 不写盘，重新武装
      await vi.advanceTimersByTimeAsync(600);
      expect(writeFileAtomic).not.toHaveBeenCalled();

      // 组合结束后下一次定时器触发才落盘
      mockComposing(view, false);
      await vi.runAllTimersAsync();
      expect(writeFileAtomic).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
