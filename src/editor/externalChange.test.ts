import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WR-07 回归：externalChange 仲裁订阅的 init/stop 代际竞态（快速切 vault）。
 *
 * onVaultChange 返回 Promise<UnlistenFn>；订阅解析前若已 stop（或又一次 init），
 * 解析拿到的 unlisten 必须被立即解掉，绝不泄漏、绝不覆盖新订阅。
 */

/** 手控解析的 onVaultChange 桩：每次调用产出一个独立 unlisten 与其 resolve 钩子。 */
const subscriptions: Array<{ unlisten: ReturnType<typeof vi.fn>; resolve: () => void }> = [];

vi.mock('../ipc/events', () => ({
  onVaultChange: vi.fn(() => {
    const unlisten = vi.fn();
    let resolveFn!: (fn: () => void) => void;
    const p = new Promise<() => void>((resolve) => {
      resolveFn = resolve;
    });
    subscriptions.push({ unlisten, resolve: () => resolveFn(unlisten) });
    return p;
  }),
}));

// 仲裁回调依赖的其它模块：本测试只关心订阅生命周期，桩成无副作用。
vi.mock('../stores/autosave', () => ({
  consumeSuppressedWatch: vi.fn().mockReturnValue(false),
  freezeAutosave: vi.fn(),
}));
vi.mock('../stores/useToastStore', () => ({ showToast: vi.fn() }));
vi.mock('./editorState', () => ({ reloadFromDisk: vi.fn() }));
vi.mock('./fileTreeData', () => ({ refreshTree: vi.fn() }));

import { initExternalChangeArbiter, stopExternalChangeArbiter } from './externalChange';

beforeEach(() => {
  subscriptions.length = 0;
});

afterEach(() => {
  stopExternalChangeArbiter();
});

describe('externalChange 订阅生命周期 (WR-07)', () => {
  it('init→stop→（订阅解析）：解析的 unlisten 被立即解掉，不泄漏', async () => {
    initExternalChangeArbiter();
    expect(subscriptions).toHaveLength(1);
    // 解析前就 stop（快速切出 vault）
    stopExternalChangeArbiter();
    // 此刻订阅 Promise 才解析
    subscriptions[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 已取消的订阅解析后必须自解，不残留监听
    expect(subscriptions[0].unlisten).toHaveBeenCalledTimes(1);
  });

  it('init→init（快速重订阅）：旧订阅解析后自解，只新订阅生效', async () => {
    initExternalChangeArbiter(); // 旧
    initExternalChangeArbiter(); // 新（stop 旧 + 自增代际）
    expect(subscriptions).toHaveLength(2);
    // 旧订阅此刻才解析：代际已变，应自解
    subscriptions[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(subscriptions[0].unlisten).toHaveBeenCalledTimes(1);
    // 新订阅解析：代际匹配，存为当前订阅（stop 时才解）
    subscriptions[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(subscriptions[1].unlisten).not.toHaveBeenCalled();
    // stop 解掉新订阅
    stopExternalChangeArbiter();
    expect(subscriptions[1].unlisten).toHaveBeenCalledTimes(1);
  });

  it('正常 init→（解析）→stop：解析后存订阅，stop 正常解一次', async () => {
    initExternalChangeArbiter();
    subscriptions[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(subscriptions[0].unlisten).not.toHaveBeenCalled();
    stopExternalChangeArbiter();
    expect(subscriptions[0].unlisten).toHaveBeenCalledTimes(1);
  });

  it('init→stop→init，新订阅先解析、旧订阅后解析：新订阅绝不被旧的 deferred 误拆', async () => {
    initExternalChangeArbiter(); // 旧 sub0
    stopExternalChangeArbiter(); // 切出（旧 sub0 仍未解析）
    initExternalChangeArbiter(); // 切入新 vault → 新 sub1
    expect(subscriptions).toHaveLength(2);
    // 新订阅先解析并成为当前订阅
    subscriptions[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 旧订阅此刻才解析：代际已变，应自解，且绝不能误拆新订阅
    subscriptions[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(subscriptions[0].unlisten).toHaveBeenCalledTimes(1); // 旧自解
    expect(subscriptions[1].unlisten).not.toHaveBeenCalled(); // 新订阅完好（未被误拆）
    // stop 应能正常解掉仍存活的新订阅
    stopExternalChangeArbiter();
    expect(subscriptions[1].unlisten).toHaveBeenCalledTimes(1);
  });
});
