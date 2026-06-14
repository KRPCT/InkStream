import { BookText, Quote, Sigma, Superscript, type LucideIcon } from 'lucide-react';
import { execute } from '../../commands/registry';

/**
 * 学术工具栏（Phase 8 ACAD-02）：Academic 模式编辑器上方常驻条——引用 / 脚注 / 参考文献 / 公式。
 * 每按钮经 registry.execute(命令 id)（D-02 同源：与命令面板/键位同一命令，行为一致）。
 * 引用=academic.cite（含 Ctrl+Shift+Z）；脚注/参考文献=academic.*；公式复用 para.math-block。
 */

const ITEMS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'academic.cite', label: '引用', icon: Quote },
  { id: 'academic.footnote', label: '脚注', icon: Superscript },
  { id: 'academic.bibliography', label: '参考文献', icon: BookText },
  { id: 'para.math-block', label: '公式', icon: Sigma },
];

export default function AcademicToolbar() {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--background-modifier-border)] bg-[var(--background-secondary)] px-2">
      {ITEMS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          onClick={() => void execute(id)}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
        >
          <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
