import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../editorState', () => ({ getDocForPath: vi.fn(), applyEditsToOpenDoc: vi.fn() }));
vi.mock('../../ipc/files', () => ({ readFile: vi.fn() }));
vi.mock('../../stores/autosave', () => ({ flushAutosave: vi.fn(), writeProjectFile: vi.fn() }));
vi.mock('../viewHandle', () => ({ getView: vi.fn() }));
vi.mock('../composition', () => ({ isComposing: vi.fn(), queueAfterComposition: vi.fn() }));

import { applyEditsToOpenDoc, getDocForPath } from '../editorState';
import { readFile } from '../../ipc/files';
import { flushAutosave, writeProjectFile } from '../../stores/autosave';
import { useEditorStore } from '../../stores/useEditorStore';
import { useProjectSearchStore } from '../../stores/useProjectSearchStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { isComposing, queueAfterComposition } from '../composition';
import { getView } from '../viewHandle';
import type { FileMatches } from './projectSearch';
import { replaceAllInProject } from './replaceAll';

const docFor = vi.mocked(getDocForPath);
const applyOpen = vi.mocked(applyEditsToOpenDoc);
const read = vi.mocked(readFile);
const flush = vi.mocked(flushAutosave);
const writeFile = vi.mocked(writeProjectFile);
const view = vi.mocked(getView);
const composing = vi.mocked(isComposing);
const queue = vi.mocked(queueAfterComposition);

const fm = (path: string): FileMatches => ({ path, matchCount: 1, excerpts: [] });

beforeEach(() => {
  docFor.mockReset();
  applyOpen.mockReset();
  read.mockReset();
  flush.mockReset().mockResolvedValue(undefined);
  writeFile.mockReset().mockResolvedValue(true);
  view.mockReset().mockReturnValue(null); // 默认无 view：组合期分支不触发
  composing.mockReset().mockReturnValue(false);
  queue.mockReset();
  useVaultStore.setState({ vault: { root: 'D:/v', repoRoot: null, name: 'v' }, files: [] });
  useEditorStore.setState({ frozen: {}, externalChanged: {}, dirty: {}, activePath: null });
  useProjectSearchStore.setState({ results: [], query: '', totalMatches: 0, truncated: false, status: 'done' });
});

describe('replaceAllInProject', () => {
  it('已打开文件：改 EditorState + flushAutosave，不直写', async () => {
    useProjectSearchStore.setState({ results: [fm('a.md')] });
    docFor.mockReturnValue('foo and foo'); // 当前真相源（已打开）
    applyOpen.mockReturnValue(true);
    const report = await replaceAllInProject('foo', 'bar');
    expect(applyOpen).toHaveBeenCalledWith('a.md', [
      { from: 0, to: 3, insert: 'bar' },
      { from: 8, to: 11, insert: 'bar' },
    ]);
    expect(flush).toHaveBeenCalledWith('a.md');
    expect(writeFile).not.toHaveBeenCalled();
    expect(report).toEqual({ files: 1, replaced: 2, skipped: [], failed: [] });
  });

  it('未打开文件：读盘真相源 + writeProjectFile 直写，不 flushAutosave', async () => {
    useProjectSearchStore.setState({ results: [fm('a.md')] });
    docFor.mockReturnValue(null); // 未打开
    read.mockResolvedValue('foo here');
    applyOpen.mockReturnValue(false);
    const report = await replaceAllInProject('foo', 'X');
    expect(writeFile).toHaveBeenCalledWith('a.md', 'X here');
    expect(flush).not.toHaveBeenCalled();
    expect(report.files).toBe(1);
    expect(report.replaced).toBe(1);
  });

  it('冲突中（frozen / externalChanged）跳过，绝不覆盖', async () => {
    useProjectSearchStore.setState({ results: [fm('frz.md'), fm('ext.md'), fm('ok.md')] });
    useEditorStore.setState({ frozen: { 'frz.md': true }, externalChanged: { 'ext.md': true } });
    docFor.mockImplementation((p) => (p === 'ok.md' ? 'foo' : 'foo'));
    applyOpen.mockReturnValue(true);
    const report = await replaceAllInProject('foo', 'bar');
    expect(report.skipped.sort()).toEqual(['ext.md', 'frz.md']);
    expect(report.files).toBe(1); // 仅 ok.md
    expect(applyOpen).toHaveBeenCalledTimes(1);
    expect(applyOpen).toHaveBeenCalledWith('ok.md', expect.anything());
  });

  it('词已不在当前真相源（搜索后被改）：静默跳过，不按陈旧偏移写', async () => {
    useProjectSearchStore.setState({ results: [fm('a.md')] });
    docFor.mockReturnValue('内容已变，没有那个词了');
    const report = await replaceAllInProject('foo', 'bar');
    expect(applyOpen).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(report).toEqual({ files: 0, replaced: 0, skipped: [], failed: [] });
  });

  it('未打开文件读盘失败 → 计入 failed', async () => {
    useProjectSearchStore.setState({ results: [fm('gone.md')] });
    docFor.mockReturnValue(null);
    read.mockRejectedValue(new Error('ENOENT'));
    const report = await replaceAllInProject('foo', 'bar');
    expect(report.failed).toEqual(['gone.md']);
  });

  it('短词 / 无 vault：空报告，不动任何文件', async () => {
    useProjectSearchStore.setState({ results: [fm('a.md')] });
    expect(await replaceAllInProject('ab', 'x')).toEqual({ files: 0, replaced: 0, skipped: [], failed: [] });
    useVaultStore.setState({ vault: null, files: [] });
    expect(await replaceAllInProject('foobar', 'x')).toEqual({ files: 0, replaced: 0, skipped: [], failed: [] });
    expect(applyOpen).not.toHaveBeenCalled();
  });

  it('冲突态按写盘时刻实时判定：循环中途被冻结的文件仍跳过（非循环起点快照）', async () => {
    useProjectSearchStore.setState({ results: [fm('a.md'), fm('b.md')] });
    docFor.mockReturnValue('foo');
    // 写 a.md 时把 b.md 冻结：逐次重读冲突态才能在下一轮跳过 b.md（快照式会漏判）。
    applyOpen.mockImplementation((p) => {
      if (p === 'a.md') useEditorStore.setState({ frozen: { 'b.md': true } });
      return true;
    });
    const report = await replaceAllInProject('foo', 'bar');
    expect(report.files).toBe(1); // 仅 a.md
    expect(report.skipped).toEqual(['b.md']);
    expect(applyOpen).toHaveBeenCalledTimes(1);
  });

  it('活动文件组合期：推迟回写到 compositionend，不当场 dispatch（吞字防护）', async () => {
    useProjectSearchStore.setState({ results: [fm('act.md')] });
    useEditorStore.setState({ activePath: 'act.md', frozen: {}, externalChanged: {}, dirty: {} });
    docFor.mockReturnValue('foo bar');
    const fakeView = {} as never;
    view.mockReturnValue(fakeView);
    composing.mockReturnValue(true);
    let deferred: (() => void) | null = null;
    queue.mockImplementation((_v, _k, cb) => {
      deferred = cb as () => void;
    });
    const report = await replaceAllInProject('foo', 'X');
    expect(queue).toHaveBeenCalledWith(fakeView, 'mb-replace:act.md', expect.any(Function));
    expect(applyOpen).not.toHaveBeenCalled(); // 组合期不当场改 doc
    expect(report.files).toBe(1); // 乐观计入，drain 时落地
    expect(deferred).toBeTypeOf('function');
  });
});
