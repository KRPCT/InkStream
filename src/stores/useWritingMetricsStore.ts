import { create } from 'zustand';

/**
 * 写作 HUD 指标（写作模式升级）：码字速度 / 码字时间 / 专注番茄钟 + HUD 悬浮位置。全部纯内存、永不持久化。
 *
 * 单向 sink：editor/writingMetrics 写入 charsPerMin（CM→store，60s 滑窗），WritingHud 的 1s tick 经
 * advance(deltaMs) 推进码字时间与番茄钟倒计时。番茄钟时长可自定义（workMs/breakMs）；HUD 可拖拽（hudX/hudY）。
 */

/** 番茄钟默认时长（25 工作 / 5 休息）；用户可自定义，此处仅作初值与测试基线。 */
export const POMODORO_WORK_MS = 25 * 60_000;
export const POMODORO_BREAK_MS = 5 * 60_000;

const MIN_MS = 60_000;
const MAX_MS = 180 * 60_000;
/** 分钟 → ms，夹到 1–180 分钟（非法输入回 1 分钟）。 */
function minToMs(min: number): number {
  if (!Number.isFinite(min)) return MIN_MS;
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(min) * 60_000));
}

type PomodoroPhase = 'work' | 'break';

interface WritingMetricsState {
  visible: boolean;
  /** HUD 悬浮位置（px，左上角）；null = 默认左下角（CSS）。拖拽后切绝对定位。 */
  hudX: number | null;
  hudY: number | null;
  charsPerMin: number;
  elapsedMs: number;
  pomodoroRunning: boolean;
  pomodoroPhase: PomodoroPhase;
  pomodoroRemainingMs: number;
  /** 番茄钟工作 / 休息时长（ms，可自定义）。 */
  workMs: number;
  breakMs: number;

  toggleVisible: () => void;
  setVisible: (visible: boolean) => void;
  setHudPos: (x: number, y: number) => void;
  reportSpeed: (charsPerMin: number) => void;
  advance: (deltaMs: number) => void;
  startPomodoro: () => void;
  pausePomodoro: () => void;
  resetPomodoro: () => void;
  setWorkMin: (min: number) => void;
  setBreakMin: (min: number) => void;
}

export const useWritingMetricsStore = create<WritingMetricsState>((set) => ({
  visible: false,
  hudX: null,
  hudY: null,
  charsPerMin: 0,
  elapsedMs: 0,
  pomodoroRunning: false,
  pomodoroPhase: 'work',
  pomodoroRemainingMs: POMODORO_WORK_MS,
  workMs: POMODORO_WORK_MS,
  breakMs: POMODORO_BREAK_MS,

  toggleVisible: () => set((s) => ({ visible: !s.visible })),
  setVisible: (visible) => set({ visible }),
  setHudPos: (hudX, hudY) => set({ hudX, hudY }),
  reportSpeed: (charsPerMin) => set({ charsPerMin }),

  advance: (deltaMs) =>
    set((s) => {
      const elapsedMs = s.elapsedMs + deltaMs;
      if (!s.pomodoroRunning) return { elapsedMs };
      let remaining = s.pomodoroRemainingMs - deltaMs;
      let phase = s.pomodoroPhase;
      while (remaining <= 0) {
        phase = phase === 'work' ? 'break' : 'work';
        remaining += phase === 'work' ? s.workMs : s.breakMs;
      }
      return { elapsedMs, pomodoroPhase: phase, pomodoroRemainingMs: remaining };
    }),

  startPomodoro: () => set({ pomodoroRunning: true }),
  pausePomodoro: () => set({ pomodoroRunning: false }),
  resetPomodoro: () =>
    set((s) => ({ pomodoroRunning: false, pomodoroPhase: 'work', pomodoroRemainingMs: s.workMs })),

  // 静止于对应相位时即时反映新时长；运行中 / 处于另一相位则下次相位翻转 / 重置时生效。
  setWorkMin: (min) =>
    set((s) => {
      const workMs = minToMs(min);
      return !s.pomodoroRunning && s.pomodoroPhase === 'work'
        ? { workMs, pomodoroRemainingMs: workMs }
        : { workMs };
    }),
  setBreakMin: (min) =>
    set((s) => {
      const breakMs = minToMs(min);
      return !s.pomodoroRunning && s.pomodoroPhase === 'break'
        ? { breakMs, pomodoroRemainingMs: breakMs }
        : { breakMs };
    }),
}));
