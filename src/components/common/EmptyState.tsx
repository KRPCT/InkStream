import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  heading: string;
  body: string;
  /** 可选操作区（如「打开文件夹」按钮），渲染在正文下方 16px 处。向后兼容：缺省不渲染。 */
  action?: ReactNode;
}

/**
 * 通用空态（UI-SPEC 空态表）：24px 图标 + heading 14/600 --text-muted
 * + body 13/400 --text-faint；图标与标题间距 16px，标题与正文间距 8px。
 * 可选 action 槽位渲染在正文下方（lg=24px 间距）。
 */
export default function EmptyState({ icon: Icon, heading, body, action }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
      <Icon size={24} strokeWidth={1.75} aria-hidden="true" className="text-[var(--text-faint)]" />
      <h3 className="mt-4 text-[14px] leading-[1.4] font-semibold text-[var(--text-muted)]">
        {heading}
      </h3>
      <p className="mt-2 text-[13px] leading-normal text-[var(--text-faint)]">{body}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
