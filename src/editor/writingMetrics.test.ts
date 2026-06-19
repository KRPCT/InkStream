import type { ViewUpdate } from '@codemirror/view';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWritingMetricsStore } from '../stores/useWritingMetricsStore';
import {
  configureWritingMetrics,
  refreshSpeed,
  resetWritingMetrics,
  syncTypingMetrics,
} from './writingMetrics';

/** 伪造插入 n 字符的 ViewUpdate（writingMetrics 只读 transactions.isUserEvent + changes.iterChanges）。 */
function insert(n: number, userInput = true): ViewUpdate {
  return {
    transactions: [{ isUserEvent: (e: string) => userInput && e === 'input' }],
    changes: { iterChanges: (cb: (...a: unknown[]) => void) => cb(0, 0, 0, n, { length: n }) },
  } as unknown as ViewUpdate;
}

let t = 0;
beforeEach(() => {
  resetWritingMetrics();
  t = 1000;
  configureWritingMetrics({ now: () => t });
  useWritingMetricsStore.setState({ charsPerMin: 0 });
});

describe('writingMetrics 码字速度（60s 滑窗）', () => {
  it('累加窗口内插入字符为码字速度', () => {
    syncTypingMetrics(insert(10));
    expect(useWritingMetricsStore.getState().charsPerMin).toBe(10);
    t = 31_000; // +30s，仍在窗口内
    syncTypingMetrics(insert(5));
    expect(useWritingMetricsStore.getState().charsPerMin).toBe(15);
  });

  it('窗口外旧样本随刷新衰减', () => {
    syncTypingMetrics(insert(10)); // t=1000
    t = 1000 + 61_000; // 第一样本已超 60s
    refreshSpeed();
    expect(useWritingMetricsStore.getState().charsPerMin).toBe(0);
  });

  it('纯删除（无插入）不计入', () => {
    syncTypingMetrics(insert(0));
    expect(useWritingMetricsStore.getState().charsPerMin).toBe(0);
  });

  it('程序化编辑（非 input 用户事务）不计入码字速度', () => {
    syncTypingMetrics(insert(500, false)); // 如插入参考文献 / 表格同步
    expect(useWritingMetricsStore.getState().charsPerMin).toBe(0);
  });
});
