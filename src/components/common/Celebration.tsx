import { useEffect, useMemo, useState } from 'react';
import './celebration.css';

/**
 * 恭喜动效（重大更新）：零依赖自绘彩带层。一次性下落 + 旋转后自卸载（DURATION_MS）。
 * prefers-reduced-motion 下不渲染（CSS 隐藏 + 这里直接 onDone）。色板为节庆固定值（独立装饰非应用 UI，
 * 不受「禁硬编码色」约束，同 export htmlDocument 字面样式纪律）。
 */
const COLORS = ['#e8c14e', '#5b8def', '#e0526a', '#54b08a', '#a86fd6', '#e89b3c'];
const PIECES = 42;
const DURATION_MS = 2800;

export default function Celebration({ onDone }: { onDone?: () => void }) {
  const reduced = useMemo(
    () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false),
    [],
  );
  const [done, setDone] = useState(false);
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        left: Math.random() * 100,
        delayMs: Math.random() * 700,
        durationMs: 1800 + Math.random() * 1400,
        color: COLORS[i % COLORS.length],
      })),
    [],
  );

  useEffect(() => {
    if (reduced) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => {
      setDone(true);
      onDone?.();
    }, DURATION_MS);
    return () => clearTimeout(t);
  }, [reduced, onDone]);

  if (reduced || done) return null;
  return (
    <div className="ink-confetti-layer" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="ink-confetti-piece"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            animationDelay: `${p.delayMs}ms`,
            animationDuration: `${p.durationMs}ms`,
          }}
        />
      ))}
    </div>
  );
}
