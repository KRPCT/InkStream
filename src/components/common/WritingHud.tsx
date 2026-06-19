import { useEffect, useRef } from 'react';
import { Gauge, Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import { refreshSpeed } from '../../editor/writingMetrics';
import {
  POMODORO_BREAK_MS,
  POMODORO_WORK_MS,
  useWritingMetricsStore,
} from '../../stores/useWritingMetricsStore';

/**
 * 写作 HUD 悬浮卡（写作模式升级）：码字速度 / 码字时间 / 专注番茄钟。默认关闭，永挂载、visible=false 时渲染 null。
 *
 * 左下角悬浮（z-50，让位 modal/onboarding 的 z-[60]；bottom-8 避开状态栏；靠左避开右下 Toast 堆叠
 * 与状态栏右侧上弹的模式/渲染菜单）。卡内一个 useEffect 拥有 1s tick：
 * 用 performance.now() 差值作 deltaMs 推进 store（advance），对 setInterval 抖动 / StrictMode 双挂载稳健
 * （每个 setInterval 配对 clearInterval）。配色全用 theme.css token，无硬编码（番茄钟进度复用 --crea-progress-*）。
 */

/** 毫秒 → mm:ss（≥1h 显示 h:mm:ss）。 */
function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default function WritingHud() {
  const visible = useWritingMetricsStore((s) => s.visible);
  if (!visible) return null;
  return <HudCard />;
}

function HudCard() {
  const charsPerMin = useWritingMetricsStore((s) => s.charsPerMin);
  const elapsedMs = useWritingMetricsStore((s) => s.elapsedMs);
  const running = useWritingMetricsStore((s) => s.pomodoroRunning);
  const phase = useWritingMetricsStore((s) => s.pomodoroPhase);
  const remainingMs = useWritingMetricsStore((s) => s.pomodoroRemainingMs);
  const advance = useWritingMetricsStore((s) => s.advance);
  const toggleVisible = useWritingMetricsStore((s) => s.toggleVisible);
  const startPomodoro = useWritingMetricsStore((s) => s.startPomodoro);
  const pausePomodoro = useWritingMetricsStore((s) => s.pausePomodoro);
  const resetPomodoro = useWritingMetricsStore((s) => s.resetPomodoro);

  const lastRef = useRef(0);
  useEffect(() => {
    lastRef.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const delta = now - lastRef.current;
      lastRef.current = now;
      advance(delta);
      refreshSpeed();
    }, 1000);
    return () => clearInterval(id);
  }, [advance]);

  const phaseTotal = phase === 'work' ? POMODORO_WORK_MS : POMODORO_BREAK_MS;
  const pct = Math.max(0, Math.min(100, Math.round(((phaseTotal - remainingMs) / phaseTotal) * 100)));

  return (
    <section
      data-testid="writing-hud"
      aria-label="写作 HUD"
      className="fixed left-4 bottom-8 z-50 w-56 rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-3 text-[12px] text-[var(--text-normal)] [box-shadow:var(--shadow-popup)]"
    >
      <header className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-medium text-[var(--text-muted)]">
          <Timer size={13} aria-hidden="true" />
          写作
        </span>
        <button
          type="button"
          onClick={toggleVisible}
          title="关闭写作 HUD"
          aria-label="关闭写作 HUD"
          className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <dl className="space-y-1">
        <div className="flex items-center justify-between">
          <dt className="flex items-center gap-1.5 text-[var(--text-muted)]">
            <Gauge size={12} aria-hidden="true" />
            码字速度
          </dt>
          <dd className="tabular-nums">
            {charsPerMin} <span className="text-[var(--text-faint)]">字/分</span>
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--text-muted)]">码字时间</dt>
          <dd className="tabular-nums">{fmt(elapsedMs)}</dd>
        </div>
      </dl>

      <div className="mt-2 border-t border-[var(--background-modifier-border)] pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-muted)]">
            {phase === 'work' ? '专注' : '休息'}
          </span>
          <span className="flex items-center gap-1">
            <span className="tabular-nums text-[14px]">{fmt(remainingMs)}</span>
            <button
              type="button"
              onClick={running ? pausePomodoro : startPomodoro}
              title={running ? '暂停番茄钟' : '开始番茄钟'}
              aria-label={running ? '暂停番茄钟' : '开始番茄钟'}
              className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
            >
              {running ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={resetPomodoro}
              title="重置番茄钟"
              aria-label="重置番茄钟"
              className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
            >
              <RotateCcw size={13} aria-hidden="true" />
            </button>
          </span>
        </div>
        <span
          role="progressbar"
          aria-label={phase === 'work' ? '专注进度' : '休息进度'}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-1.5 block h-1 w-full overflow-hidden rounded-full"
          style={{ backgroundColor: 'var(--crea-progress-track)' }}
        >
          <span
            aria-hidden="true"
            className="block h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: 'var(--crea-progress-fill)' }}
          />
        </span>
      </div>
    </section>
  );
}
