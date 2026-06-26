import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../editorState', () => ({ getDocForPath: vi.fn() }));
vi.mock('../../ipc/files', () => ({ readFile: vi.fn() }));
vi.mock('./multibufferWrite', () => ({ applyRangeEdits: vi.fn() }));

import { getDocForPath } from '../editorState';
import { readFile } from '../../ipc/files';
import { applyRangeEdits } from './multibufferWrite';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { commitExcerptEdit } from './excerptEdit';

const docFor = vi.mocked(getDocForPath);
const read = vi.mocked(readFile);
const write = vi.mocked(applyRangeEdits);

beforeEach(() => {
  docFor.mockReset();
  read.mockReset();
  write.mockReset().mockResolvedValue(true);
  useVaultStore.setState({ vault: { root: 'D:/v', repoRoot: null, name: 'v' }, files: [] });
  useEditorStore.setState({ frozen: {}, externalChanged: {}, dirty: {}, activePath: null });
});

describe('commitExcerptEdit', () => {
  it('无改动 → unchanged，不写', async () => {
    expect(await commitExcerptEdit('a.md', 0, 'same', 'same')).toBe('unchanged');
    expect(write).not.toHaveBeenCalled();
  });

  it('期望落点匹配 → 原位回写 applied', async () => {
    docFor.mockReturnValue('hello world');
    const r = await commitExcerptEdit('a.md', 6, 'world', 'WORLD');
    expect(r).toBe('applied');
    expect(write).toHaveBeenCalledWith('a.md', 'hello world', [{ from: 6, to: 11, insert: 'WORLD' }]);
  });

  it('落点漂移但原文唯一 → 内容重锚 applied', async () => {
    docFor.mockReturnValue('XX hello world'); // 'world' 唯一出现在偏移 9，而非陈旧的 sourceFrom=0
    const r = await commitExcerptEdit('a.md', 0, 'world', 'WORLD');
    expect(r).toBe('applied');
    expect(write).toHaveBeenCalledWith('a.md', 'XX hello world', [{ from: 9, to: 14, insert: 'WORLD' }]);
  });

  it('原文多处歧义 → moved 拒写', async () => {
    docFor.mockReturnValue('world and world');
    expect(await commitExcerptEdit('a.md', 100, 'world', 'X')).toBe('moved');
    expect(write).not.toHaveBeenCalled();
  });

  it('原文已不在真相源 → moved', async () => {
    docFor.mockReturnValue('nothing here');
    expect(await commitExcerptEdit('a.md', 0, 'world', 'X')).toBe('moved');
  });

  it('冲突中（frozen / externalChanged）→ skipped，不读不写', async () => {
    useEditorStore.setState({ frozen: { 'a.md': true } });
    expect(await commitExcerptEdit('a.md', 0, 'world', 'X')).toBe('skipped');
    expect(docFor).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('未打开文件 → 读盘真相源后回写', async () => {
    docFor.mockReturnValue(null);
    read.mockResolvedValue('hello world');
    const r = await commitExcerptEdit('a.md', 6, 'world', 'WORLD');
    expect(read).toHaveBeenCalledWith('D:/v', 'a.md');
    expect(r).toBe('applied');
  });

  it('读盘失败 → failed', async () => {
    docFor.mockReturnValue(null);
    read.mockRejectedValue(new Error('ENOENT'));
    expect(await commitExcerptEdit('a.md', 0, 'world', 'X')).toBe('failed');
  });

  it('无 vault → failed', async () => {
    useVaultStore.setState({ vault: null, files: [] });
    expect(await commitExcerptEdit('a.md', 0, 'world', 'X')).toBe('failed');
  });

  it('回写底座失败（applyRangeEdits false）→ failed', async () => {
    docFor.mockReturnValue('hello world');
    write.mockResolvedValue(false);
    expect(await commitExcerptEdit('a.md', 6, 'world', 'WORLD')).toBe('failed');
  });
});
