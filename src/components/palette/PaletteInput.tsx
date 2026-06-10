import { useEffect, useRef } from 'react';

interface PaletteInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * 命令面板输入框（UI-SPEC：高 36、文本 14/400）。受控 onChange——IME 组合中
 * 也实时过滤（无害，Pitfall 4 只约束 Enter 执行，防御在 CommandPalette）。
 */
export default function PaletteInput({ value, onChange, onKeyDown }: PaletteInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      value={value}
      placeholder="输入命令名称"
      aria-label="命令输入"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className="h-9 w-full border-b border-[var(--background-modifier-border)] bg-transparent px-3 text-[14px] font-normal text-[var(--text-normal)] outline-none placeholder:text-[var(--text-faint)]"
    />
  );
}
