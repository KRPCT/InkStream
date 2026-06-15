import { PenLine } from 'lucide-react';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useWordCountStore } from '../../stores/useWordCountStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';

/**
 * 今日字数目标进度（CREA-04，StatusBar）：仅 Creative 模式 + 目标 > 0 时显示（自门，同 CitationIndicator）。
 * 数据源 useWordCountStore.todayWritten（editor/wordCount 单向镜像，仅记编辑增量、换日重置）+ 设置 dailyWordGoal。
 * 进度填充用专用 token var(--crea-progress-fill)（非 --accent，遵 theme.css 规则）；达标转 --crea-status-final。
 */
export default function WordCountIndicator() {
  const mode = useWorkbenchStore((s) => s.mode);
  const goal = useSettingsStore((s) => s.dailyWordGoal);
  const written = useWordCountStore((s) => s.todayWritten);

  if (mode !== 'creative' || goal <= 0) return null;
  const pct = Math.min(100, Math.round((written / goal) * 100));
  const reached = written >= goal;

  return (
    <div
      data-testid="word-count-indicator"
      className="flex h-full items-center gap-1.5 border-l border-[var(--background-modifier-border)] px-2"
      title={`今日已写 ${written} / 目标 ${goal} 字`}
    >
      <PenLine size={12} aria-hidden="true" />
      <span className="tabular-nums">
        {written}/{goal}
      </span>
      <span
        aria-hidden="true"
        className="h-1 w-14 overflow-hidden rounded-full"
        style={{ backgroundColor: 'var(--crea-progress-track)' }}
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: reached ? 'var(--crea-status-final)' : 'var(--crea-progress-fill)',
          }}
        />
      </span>
    </div>
  );
}
