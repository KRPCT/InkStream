import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { Command } from '../types/commands';
import { hydrate, list } from './mru';
import { execute, getAll, register, subscribe } from './registry';

const disposers: Array<() => void> = [];

function reg(cmd: Partial<Command> & { id: string }): () => void {
  const dispose = register({ title: cmd.id, run: () => {}, ...cmd });
  disposers.push(dispose);
  return dispose;
}

describe('registry', () => {
  beforeEach(() => hydrate([]));

  afterEach(() => {
    while (disposers.length) disposers.pop()!();
    useSettingsStore.getState().setSimpleMode(false);
  });

  it('register 后 getAll 含该命令', () => {
    reg({ id: 'test.a', title: '测试：甲' });
    expect(getAll().map((c) => c.id)).toContain('test.a');
    expect(getAll().find((c) => c.id === 'test.a')?.title).toBe('测试：甲');
  });

  it('dispose 后命令消失，重复 dispose 无害', () => {
    const dispose = reg({ id: 'test.a' });
    dispose();
    dispose();
    expect(getAll().map((c) => c.id)).not.toContain('test.a');
  });

  it('重复 id register 抛错', () => {
    reg({ id: 'test.a' });
    expect(() => register({ id: 'test.a', title: '重复', run: () => {} })).toThrow();
  });

  it('execute 运行 run 并把 id 推入 MRU 头部', async () => {
    const run = vi.fn();
    reg({ id: 'test.a', run });
    reg({ id: 'test.b' });
    await execute('test.b');
    await execute('test.a');
    expect(run).toHaveBeenCalledTimes(1);
    expect(list()[0]).toBe('test.a');
    expect(list()).toEqual(['test.a', 'test.b']);
  });

  it('execute 未注册 id 静默忽略', async () => {
    await expect(execute('test.missing')).resolves.toBeUndefined();
    expect(list()).toEqual([]);
  });

  it('简易模式下 advanced 命令 execute 一律 no-op 且不记 MRU', async () => {
    const run = vi.fn();
    reg({ id: 'test.adv', advanced: true, run });
    useSettingsStore.getState().setSimpleMode(true);
    await execute('test.adv');
    expect(run).not.toHaveBeenCalled();
    expect(list()).toEqual([]);
    // 关掉简易模式后恢复执行。
    useSettingsStore.getState().setSimpleMode(false);
    await execute('test.adv');
    expect(run).toHaveBeenCalledTimes(1);
    expect(list()[0]).toBe('test.adv');
  });

  it('简易模式不影响普通（非 advanced）命令', async () => {
    const run = vi.fn();
    reg({ id: 'test.basic', run });
    useSettingsStore.getState().setSimpleMode(true);
    await execute('test.basic');
    expect(run).toHaveBeenCalledTimes(1);
    expect(list()[0]).toBe('test.basic');
  });

  it('subscribe 在注册/注销时收到通知，退订后不再收', () => {
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    const dispose = reg({ id: 'test.a' });
    expect(cb).toHaveBeenCalledTimes(1);
    dispose();
    expect(cb).toHaveBeenCalledTimes(2);
    unsubscribe();
    reg({ id: 'test.b' });
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
