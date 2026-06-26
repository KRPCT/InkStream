import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../editorState', () => ({ applyEditsToOpenDoc: vi.fn() }));
vi.mock('../../stores/autosave', () => ({ flushAutosave: vi.fn(), writeProjectFile: vi.fn() }));
vi.mock('../composition', () => ({ isComposing: vi.fn(), queueAfterComposition: vi.fn() }));
vi.mock('../viewHandle', () => ({ getView: vi.fn() }));

import { applyEditsToOpenDoc } from '../editorState';
import { flushAutosave, writeProjectFile } from '../../stores/autosave';
import { isComposing, queueAfterComposition } from '../composition';
import { getView } from '../viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { applyEditsToString, applyRangeEdits } from './multibufferWrite';

const applyOpen = vi.mocked(applyEditsToOpenDoc);
const flush = vi.mocked(flushAutosave);
const writeFile = vi.mocked(writeProjectFile);
const composing = vi.mocked(isComposing);
const queue = vi.mocked(queueAfterComposition);
const view = vi.mocked(getView);

/** 可变 doc 的假 view：state.doc.length/sliceString 实时读 holder.s，便于模拟组合期 drain 时 doc 位移。 */
function fakeView(initial: string) {
  const holder = { s: initial };
  const v = {
    state: {
      doc: {
        get length() {
          return holder.s.length;
        },
        sliceString: (a: number, b: number) => holder.s.slice(a, b),
      },
    },
    dispatch: vi.fn(),
  };
  return { v, holder };
}

beforeEach(() => {
  applyOpen.mockReset();
  flush.mockReset().mockResolvedValue(undefined);
  writeFile.mockReset().mockResolvedValue(true);
  composing.mockReset().mockReturnValue(false);
  queue.mockReset();
  view.mockReset().mockReturnValue(null);
  useEditorStore.setState({ activePath: null, frozen: {}, externalChanged: {}, dirty: {} });
});

describe('applyEditsToString', () => {
  it('自后向前应用，偏移不串位', () => {
    expect(
      applyEditsToString('foo bar baz', [
        { from: 0, to: 3, insert: 'X' },
        { from: 8, to: 11, insert: 'Y' },
      ]),
    ).toBe('X bar Y');
  });

  it('乱序输入先排序再回写', () => {
    expect(
      applyEditsToString('foo bar baz', [
        { from: 8, to: 11, insert: 'Y' },
        { from: 0, to: 3, insert: 'X' },
      ]),
    ).toBe('X bar Y');
  });

  it('空编辑返原文', () => {
    expect(applyEditsToString('abc', [])).toBe('abc');
  });
});

describe('applyRangeEdits', () => {
  it('已打开 → applyEditsToOpenDoc + markDirty + flush，不直写', async () => {
    applyOpen.mockReturnValue(true);
    const ok = await applyRangeEdits('a.md', 'ignored', [{ from: 0, to: 1, insert: 'X' }]);
    expect(ok).toBe(true);
    expect(applyOpen).toHaveBeenCalledWith('a.md', [{ from: 0, to: 1, insert: 'X' }]);
    expect(flush).toHaveBeenCalledWith('a.md');
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('未打开 → 在 diskContent 上算最终内容直写', async () => {
    applyOpen.mockReturnValue(false);
    const ok = await applyRangeEdits('a.md', 'foo bar', [{ from: 0, to: 3, insert: 'X' }]);
    expect(writeFile).toHaveBeenCalledWith('a.md', 'X bar');
    expect(flush).not.toHaveBeenCalled();
    expect(ok).toBe(true);
  });

  it('活动文件组合期 → 推迟到 compositionend，不当场 dispatch；drain 时区间未变即写', async () => {
    const { v } = fakeView('Xbc');
    view.mockReturnValue(v as never);
    composing.mockReturnValue(true);
    useEditorStore.setState({ activePath: 'a.md' });
    let deferred: (() => void) | null = null;
    queue.mockImplementation((_v, _k, cb) => {
      deferred = cb as () => void;
    });
    const ok = await applyRangeEdits('a.md', 'x', [{ from: 0, to: 1, insert: 'Z' }]);
    expect(ok).toBe(true);
    expect(queue).toHaveBeenCalledWith(v, 'mb-write:a.md', expect.any(Function));
    expect(applyOpen).not.toHaveBeenCalled();
    expect(v.dispatch).not.toHaveBeenCalled(); // 当场不 dispatch
    deferred!();
    expect(v.dispatch).toHaveBeenCalledWith({ changes: [{ from: 0, to: 1, insert: 'Z' }] }); // 区间未变 → 落地
  });

  it('组合期 drain 时区间已位移 → 放弃，不按陈旧偏移错位写', async () => {
    const { v, holder } = fakeView('Xbc');
    view.mockReturnValue(v as never);
    composing.mockReturnValue(true);
    useEditorStore.setState({ activePath: 'a.md' });
    let deferred: (() => void) | null = null;
    queue.mockImplementation((_v, _k, cb) => {
      deferred = cb as () => void;
    });
    await applyRangeEdits('a.md', 'x', [{ from: 0, to: 1, insert: 'Z' }]);
    holder.s = 'QQXbc'; // 组合期前插入字符：偏移 0 处已不再是捕获时的 'X'
    deferred!();
    expect(v.dispatch).not.toHaveBeenCalled(); // 期望旧值不符 → 整体放弃
  });

  it('空编辑：直接成功，不触碰任何写', async () => {
    const ok = await applyRangeEdits('a.md', 'x', []);
    expect(ok).toBe(true);
    expect(applyOpen).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
