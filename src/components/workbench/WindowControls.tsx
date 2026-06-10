import { Minus, Square, X } from 'lucide-react';
import { windowControls } from '../../ipc/window';

const BASE =
  'flex w-[46px] items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-normal)]';

/**
 * Windows/Linux 自绘窗口控制（UI-SPEC：46x36 命中区，16px 图标）。
 * 关闭按钮 hover #e81123 + 白色图标为平台惯例豁免色（唯一允许的硬编码色值）。
 */
export default function WindowControls() {
  return (
    <div className="flex h-full shrink-0 items-stretch">
      <button
        type="button"
        aria-label="最小化"
        onClick={() => void windowControls.minimize()}
        className={`${BASE} hover:bg-[var(--background-modifier-hover)]`}
      >
        <Minus size={16} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label="最大化"
        onClick={() => void windowControls.toggleMaximize()}
        className={`${BASE} hover:bg-[var(--background-modifier-hover)]`}
      >
        <Square size={16} strokeWidth={1.75} />
      </button>
      <button
        type="button"
        aria-label="关闭"
        onClick={() => void windowControls.close()}
        className={`${BASE} hover:bg-[#e81123] hover:text-white`}
      >
        <X size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
