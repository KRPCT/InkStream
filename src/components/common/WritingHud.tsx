import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Gauge, Pause, Play, RotateCcw, Timer, X } from 'lucide-react';
import { refreshSpeed } from '../../editor/writingMetrics';
import { useWritingMetricsStore } from '../../stores/useWritingMetricsStore';

/**
 * 写作 HUD 悬浮卡（写作模式升级）：码字速度 / 码字时间 / 专注番茄钟。默认关闭，永挂载、visible=false 时渲染 null。
 *
 * 可拖拽：拖标题栏移动到任意位置（pointer capture，位置存 store 跨开关保留）；番茄钟时长可自定义（分钟输入）。
 * z-50，让位 modal/onboarding 的 z-[60]。卡内一个 useEffect 拥 1s tick（StrictMode 安全 clearInterval）。
 * 不程序化聚焦编辑器（IME 纪律）；配色全用 theme.css token。
 */

const BTN =
  'rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]';

/** 毫秒 → mm:ss（≥1h 显示 h:mm:ss）。 */
function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function MinInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      min={1}
      max={180}
      value={value}
      onChange={(e) => {
        // 空串不提交（否则清空即被钳到 1 分钟，无法整段重输多位数）。
        if (e.target.value !== '') onChange(Number(e.target.value));
      }}
      className="w-9 rounded border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-1 text-center text-[12px] tabular-nums text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
    />
  );
}

export default function WritingHud() {
  const visible = useWritingMetricsStore((s) => s.visible);
  if (!visible) return null;
  return <HudCard />;
}

function HudCard() {
  const s = useWritingMetricsStore();
  const sectionRef = useRef<HTMLElement>(null);
  const drag = useRef<{ dx: number; dy: number; x: number; y: number } | null>(null);

  const lastRef = useRef(0);
  useEffect(() => {
    // 单次创建间隔；advance 经 getState() 取最新（稳定 action，无需进 deps，避免每渲染重建间隔）。
    lastRef.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const delta = now - lastRef.current;
      lastRef.current = now;
      useWritingMetricsStore.getState().advance(delta);
      refreshSpeed();
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const phaseTotal = s.pomodoroPhase === 'work' ? s.workMs : s.breakMs;
  const pct = Math.max(0, Math.min(100, Math.round(((phaseTotal - s.pomodoroRemainingMs) / phaseTotal) * 100)));
  const style: CSSProperties =
    s.hudX !== null && s.hudY !== null
      ? { left: s.hudX, top: s.hudY }
      : { left: '1rem', bottom: '2rem' };

  // 拖拽标题栏移动（pointer capture：指针离开标题栏仍跟手）；点到按钮不触发拖拽。
  // 拖拽期命令式改 element.style（不经 store，避免每 pointermove 整卡重渲），松手才提交位置到 store 持久。
  const onDown = (e: ReactPointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return; // 让位关闭按钮
    const rect = sectionRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, x: rect.left, y: rect.top };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent): void => {
    const el = sectionRef.current;
    if (!drag.current || !el) return;
    const x = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, e.clientX - drag.current.dx));
    const y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, e.clientY - drag.current.dy));
    drag.current.x = x;
    drag.current.y = y;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.bottom = 'auto';
  };
  const onUp = (e: ReactPointerEvent): void => {
    if (!drag.current) return;
    s.setHudPos(drag.current.x, drag.current.y); // 提交 → 持久 + 下次渲染由 style prop 接管
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <section
      ref={sectionRef}
      data-testid="writing-hud"
      aria-label="写作 HUD"
      style={style}
      className="fixed z-50 w-56 rounded-[8px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] p-3 text-[12px] text-[var(--text-normal)] [box-shadow:var(--shadow-popup)]"
    >
      <header
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="mb-2 flex cursor-move touch-none select-none items-center justify-between"
      >
        <span className="flex items-center gap-1.5 font-medium text-[var(--text-muted)]">
          <Timer size={13} aria-hidden="true" />
          写作
        </span>
        <button type="button" onClick={s.toggleVisible} title="关闭写作 HUD" aria-label="关闭写作 HUD" className={BTN}>
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
            {s.charsPerMin} <span className="text-[var(--text-faint)]">字/分</span>
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--text-muted)]">码字时间</dt>
          <dd className="tabular-nums">{fmt(s.elapsedMs)}</dd>
        </div>
      </dl>

      <div className="mt-2 border-t border-[var(--background-modifier-border)] pt-2">
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-muted)]">{s.pomodoroPhase === 'work' ? '专注' : '休息'}</span>
          <span className="flex items-center gap-1">
            <span className="tabular-nums text-[14px]">{fmt(s.pomodoroRemainingMs)}</span>
            <button
              type="button"
              onClick={s.pomodoroRunning ? s.pausePomodoro : s.startPomodoro}
              title={s.pomodoroRunning ? '暂停番茄钟' : '开始番茄钟'}
              aria-label={s.pomodoroRunning ? '暂停番茄钟' : '开始番茄钟'}
              className={BTN}
            >
              {s.pomodoroRunning ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            </button>
            <button type="button" onClick={s.resetPomodoro} title="重置番茄钟" aria-label="重置番茄钟" className={BTN}>
              <RotateCcw size={13} aria-hidden="true" />
            </button>
          </span>
        </div>
        <span
          role="progressbar"
          aria-label={s.pomodoroPhase === 'work' ? '专注进度' : '休息进度'}
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
        <div className="mt-1.5 flex items-center justify-between text-[var(--text-faint)]">
          <label className="flex items-center gap-1">
            专注
            <MinInput value={Math.round(s.workMs / 60_000)} onChange={s.setWorkMin} />分
          </label>
          <label className="flex items-center gap-1">
            休息
            <MinInput value={Math.round(s.breakMs / 60_000)} onChange={s.setBreakMin} />分
          </label>
        </div>
      </div>
    </section>
  );
}
