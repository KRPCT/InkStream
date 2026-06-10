interface KbdProps {
  children: string;
  /** 命令面板行内快捷键用 faint（UI-SPEC 行规格），默认 muted。 */
  tone?: 'muted' | 'faint';
}

/** kbd 快捷键芯片（UI-SPEC 组件契约）：12px 等宽、1px 边框、4px 圆角、内边距 2px 6px。 */
export default function Kbd({ children, tone = 'muted' }: KbdProps) {
  const color = tone === 'faint' ? 'text-[var(--text-faint)]' : 'text-[var(--text-muted)]';
  return (
    <kbd
      className={`rounded-[4px] border border-[var(--background-modifier-border)] px-[6px] py-[2px] text-[12px] leading-[1.4] [font-family:var(--font-mono)] ${color}`}
    >
      {children}
    </kbd>
  );
}
