import { beforeEach, describe, expect, it } from 'vitest';
import { hydrate, list, record } from './mru';

describe('mru', () => {
  beforeEach(() => hydrate([]));

  it('record 后 list 头部即该 id', () => {
    record('a');
    expect(list()[0]).toBe('a');
  });

  it('后 record 的排前面', () => {
    record('a');
    record('b');
    expect(list()).toEqual(['b', 'a']);
  });

  it('重复 record 提升到头部且不重复', () => {
    record('a');
    record('b');
    record('a');
    expect(list()).toEqual(['a', 'b']);
  });

  it('超过 10 条裁断', () => {
    for (let i = 0; i < 12; i++) record(`cmd-${i}`);
    expect(list()).toHaveLength(10);
    expect(list()[0]).toBe('cmd-11');
    expect(list()).not.toContain('cmd-0');
    expect(list()).not.toContain('cmd-1');
  });

  it('hydrate 整体载入并同样裁到 10', () => {
    hydrate(['x', 'y', 'z']);
    expect(list()).toEqual(['x', 'y', 'z']);
    hydrate(Array.from({ length: 15 }, (_, i) => `h-${i}`));
    expect(list()).toHaveLength(10);
  });

  it('list 返回副本，外部改动不影响内部', () => {
    record('a');
    list().push('b');
    expect(list()).toEqual(['a']);
  });
});
