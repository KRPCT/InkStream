import type { ReactNode } from 'react';

/**
 * 帮助/教程的共享版式原语（从 helpContent 析出，供各主题分区复用，避免单文件超 200 行）。
 * 纯展示组件、无状态；元素色一律走 CSS 变量（无硬编色）。
 */

export function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 mb-2 text-[15px] font-semibold text-[var(--text-normal)]">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-[13px] leading-relaxed text-[var(--text-muted)]">{children}</p>;
}

export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mb-2 ml-4 list-decimal space-y-1 text-[13px] leading-relaxed text-[var(--text-muted)]">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  );
}

export function K({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--background-modifier-border)] bg-[var(--background-secondary)] px-1 text-[11px] text-[var(--text-normal)]">
      {children}
    </kbd>
  );
}

export function Tip({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 rounded-[4px] border-l-2 border-[var(--accent)] bg-[var(--background-secondary)] px-3 py-1.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
      {children}
    </p>
  );
}
