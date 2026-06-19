import { describe, expect, it } from 'vitest';
import { assembleResolution, conflictCount, parseConflicts } from './parseConflicts';

describe('parseConflicts', () => {
  it('切分干净段与冲突块', () => {
    const content = 'a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> x\nd';
    const parts = parseConflicts(content);
    expect(parts).toEqual([
      { kind: 'clean', text: 'a' },
      { kind: 'conflict', ours: 'b', theirs: 'c' },
      { kind: 'clean', text: 'd' },
    ]);
    expect(conflictCount(parts)).toBe(1);
  });

  it('无标记返回单个干净段', () => {
    const parts = parseConflicts('hello\nworld');
    expect(parts).toEqual([{ kind: 'clean', text: 'hello\nworld' }]);
    expect(conflictCount(parts)).toBe(0);
  });

  it('diff3 风格丢弃 base 块，保留 ours/theirs', () => {
    const content = '<<<<<<< HEAD\nb1\nb2\n||||||| base\nx\n=======\nc\n>>>>>>> y';
    const parts = parseConflicts(content);
    expect(parts).toEqual([{ kind: 'conflict', ours: 'b1\nb2', theirs: 'c' }]);
  });

  it('多冲突块按序解析', () => {
    const content = '<<<<<<< a\n1\n=======\n2\n>>>>>>> b\nmid\n<<<<<<< a\n3\n=======\n4\n>>>>>>> b';
    expect(conflictCount(parseConflicts(content))).toBe(2);
  });
});

describe('assembleResolution', () => {
  const parts = parseConflicts('a\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> x\nd');

  it('采纳 ours / theirs / both', () => {
    expect(assembleResolution(parts, ['ours'])).toBe('a\nb\nd');
    expect(assembleResolution(parts, ['theirs'])).toBe('a\nc\nd');
    expect(assembleResolution(parts, ['both'])).toBe('a\nb\nc\nd');
  });

  it('缺省选择按 ours', () => {
    expect(assembleResolution(parts, [])).toBe('a\nb\nd');
  });

  it('采纳纯删除侧不留空行（空 ours/theirs）', () => {
    const p = parseConflicts('before\n<<<<<<< HEAD\n=======\nx\n>>>>>>> b\nafter');
    expect(p).toEqual([
      { kind: 'clean', text: 'before' },
      { kind: 'conflict', ours: '', theirs: 'x' },
      { kind: 'clean', text: 'after' },
    ]);
    expect(assembleResolution(p, ['ours'])).toBe('before\nafter'); // 删除：无空行
    expect(assembleResolution(p, ['theirs'])).toBe('before\nx\nafter');
    expect(assembleResolution(p, ['both'])).toBe('before\nx\nafter'); // both 过滤空侧
  });
});
