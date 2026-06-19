import { create } from 'zustand';

/**
 * 写作 HUD 指标（写作模式升级）：码字速度 / 码字时间 / 专注番茄钟。全部纯内存、永不持久化（约束）。
 *
 * 单向 sink：editor/writingMetrics 写入 charsPerMin（CM→store，60s 滑窗），WritingHud 的 1s tick 经
 * advance(deltaMs) 推进码字时间与番茄钟倒计时。store 永不回写 CM。番茄钟用「按真实时间增量推进」模型
 * （delta 来自 performance.now() 差值），对 tick 抖动 / StrictMode 双挂载稳健，且便于单测。
 */

const WORK_MS = 25 * 60_000;
const BREAK_MS = 5 * 60_000;
export const POMODORO_WORK_MS = WORK_MS;
export const POMODORO_BREAK_MS = BREAK_MS;

type PomodoroPhase = 'work' | 'break';

interface WritingMetricsState {
  /** HUD 是否可见（默认关闭——规格：默认不开启，仅 Creative 状态栏给提示入口）。 */
  visible: boolean;
  /** 码字速度：最近 60s 内净插入字符数（即 字/分），由 writingMetrics 滑窗写入。 */
  charsPerMin: number;
  /** 码字时间：HUD 打开期间累计墙钟（毫秒），关闭即冻结、重开续计。 */
  elapsedMs: number;
  pomodoroRunning: boolean;
  pomodoroPhase: PomodoroPhase;
  pomodoroRemainingMs: number;

  toggleVisible: () => void;
  setVisible: (visible: boolean) => void;
  reportSpeed: (charsPerMin: number) => void;
  /** WritingHud 每秒调用：按真实时间增量推进码字时间 + 番茄钟（运行时倒计时，归零翻相）。 */
  advance: (deltaMs: number) => void;
  startPomodoro: () => void;
  pausePomodoro: () => void;
  resetPomodoro: () => void;
}

export const useWritingMetricsStore = create<WritingMetricsState>((set) => ({
  visible: false,
  charsPerMin: 0,
  elapsedMs: 0,
  pomodoroRunning: false,
  pomodoroPhase: 'work',
  pomodoroRemainingMs: WORK_MS,

  toggleVisible: () => set((s) => ({ visible: !s.visible })),
  setVisible: (visible) => set({ visible }),
  reportSpeed: (charsPerMin) => set({ charsPerMin }),

  advance: (deltaMs) =>
    set((s) => {
      const elapsedMs = s.elapsedMs + deltaMs;
      if (!s.pomodoroRunning) return { elapsedMs };
      let remaining = s.pomodoroRemainingMs - deltaMs;
      let phase = s.pomodoroPhase;
      // 跨多个相位消化 overshoot：用 += 累加新相位时长，休眠 / 后台节流导致的大 delta 不丢时间、不卡在一相。
      while (remaining <= 0) {
        phase = phase === 'work' ? 'break' : 'work';
        remaining += phase === 'work' ? WORK_MS : BREAK_MS;
      }
      return { elapsedMs, pomodoroPhase: phase, pomodoroRemainingMs: remaining };
    }),

  startPomodoro: () => set({ pomodoroRunning: true }),
  pausePomodoro: () => set({ pomodoroRunning: false }),
  resetPomodoro: () =>
    set({ pomodoroRunning: false, pomodoroPhase: 'work', pomodoroRemainingMs: WORK_MS }),
}));
