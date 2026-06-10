/** kbd 快捷键芯片（UI-SPEC 组件契约）：12px 等宽、1px 边框、4px 圆角、内边距 2px 6px。 */
export default function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded-[4px] border border-[var(--background-modifier-border)] px-[6px] py-[2px] text-[12px] leading-[1.4] text-[var(--text-muted)] [font-family:var(--font-mono)]">
      {children}
    </kbd>
  );
}
