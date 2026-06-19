import { Gauge } from 'lucide-react';
import { execute } from '../../commands/registry';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { useWritingMetricsStore } from '../../stores/useWritingMetricsStore';

/**
 * 写作 HUD 入口提示（写作模式升级，StatusBar）：仅 Creative 模式显示（自门，同 WordCountIndicator）。
 * 规格：HUD 默认关闭，此处只给一个醒目入口。点击经 registry.execute('writing.toggle-hud') 路由
 * （保持 MRU / 门控一致），HUD 开启时高亮。写作辅助非 advanced——简易模式下仍可用，故不走 capabilities。
 */
export default function HudHintIndicator() {
  const mode = useWorkbenchStore((s) => s.mode);
  const visible = useWritingMetricsStore((s) => s.visible);
  if (mode !== 'creative') return null;
  return (
    <button
      type="button"
      data-testid="hud-hint-indicator"
      aria-pressed={visible}
      onClick={() => void execute('writing.toggle-hud')}
      title="写作 HUD：码字速度 / 码字时间 / 专注番茄钟"
      className={`flex h-full items-center gap-1.5 border-l border-[var(--background-modifier-border)] px-2 hover:bg-[var(--background-modifier-hover)] ${
        visible ? 'text-[var(--text-normal)]' : ''
      }`}
    >
      <Gauge size={12} aria-hidden="true" />
      <span>写作 HUD</span>
    </button>
  );
}
