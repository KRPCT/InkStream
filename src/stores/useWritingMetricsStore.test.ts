import { beforeEach, describe, expect, it } from 'vitest';
import {
  POMODORO_BREAK_MS,
  POMODORO_WORK_MS,
  useWritingMetricsStore,
} from './useWritingMetricsStore';

const s = () => useWritingMetricsStore.getState();

beforeEach(() => {
  useWritingMetricsStore.setState(useWritingMetricsStore.getInitialState(), true);
});

describe('useWritingMetricsStore', () => {
  it('默认 HUD 关闭、番茄钟停在专注满程', () => {
    expect(s().visible).toBe(false);
    expect(s().pomodoroRunning).toBe(false);
    expect(s().pomodoroPhase).toBe('work');
    expect(s().pomodoroRemainingMs).toBe(POMODORO_WORK_MS);
  });

  it('toggleVisible 翻转可见性', () => {
    s().toggleVisible();
    expect(s().visible).toBe(true);
  });

  it('advance 累加码字时间', () => {
    s().advance(5000);
    expect(s().elapsedMs).toBe(5000);
  });

  it('番茄钟未启动时 advance 不动倒计时', () => {
    s().advance(10_000);
    expect(s().pomodoroRemainingMs).toBe(POMODORO_WORK_MS);
    expect(s().elapsedMs).toBe(10_000);
  });

  it('启动后倒计时归零翻到休息，再归零翻回专注', () => {
    s().startPomodoro();
    s().advance(POMODORO_WORK_MS);
    expect(s().pomodoroPhase).toBe('break');
    expect(s().pomodoroRemainingMs).toBe(POMODORO_BREAK_MS);
    s().advance(POMODORO_BREAK_MS);
    expect(s().pomodoroPhase).toBe('work');
    expect(s().pomodoroRemainingMs).toBe(POMODORO_WORK_MS);
  });

  it('大 delta 跨多相位消化 overshoot（休眠 / 后台节流不丢时间）', () => {
    s().startPomodoro();
    // 一次 delta 跨 work→break→work，落在第二个 work 的 1s 处。
    s().advance(POMODORO_WORK_MS + POMODORO_BREAK_MS + 1000);
    expect(s().pomodoroPhase).toBe('work');
    expect(s().pomodoroRemainingMs).toBe(POMODORO_WORK_MS - 1000);
  });

  it('暂停后倒计时冻结，但码字时间继续累加', () => {
    s().startPomodoro();
    s().advance(60_000);
    const frozen = s().pomodoroRemainingMs;
    s().pausePomodoro();
    s().advance(60_000);
    expect(s().pomodoroRemainingMs).toBe(frozen);
    expect(s().elapsedMs).toBe(120_000);
  });

  it('reset 停止并回到专注满程', () => {
    s().startPomodoro();
    s().advance(60_000);
    s().resetPomodoro();
    expect(s().pomodoroRunning).toBe(false);
    expect(s().pomodoroPhase).toBe('work');
    expect(s().pomodoroRemainingMs).toBe(POMODORO_WORK_MS);
  });
});
