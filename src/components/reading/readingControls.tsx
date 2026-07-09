/** 阅读工具栏共享控件（FEAT-READ）：分段选择器 + 图标按钮类，供 ReadingView 与 ReadingSettingsMenu 复用。 */

export const ICON_BTN =
  'rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]';
export const NAV_BTN = `${ICON_BTN} disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent`;

/** 分段控件：一组互斥选项，当前项高亮（落地页阅读演示同款）。 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 overflow-hidden rounded-[7px] border border-[var(--background-modifier-border)]"
    >
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
          className={`px-2.5 py-1 text-[12px] transition-colors ${
            i > 0 ? 'border-l border-[var(--background-modifier-border)]' : ''
          } ${
            value === o.id
              ? 'bg-[var(--background-modifier-active)] font-medium text-[var(--text-normal)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
