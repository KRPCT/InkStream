import { Quote, Sigma, Superscript, type LucideIcon } from 'lucide-react';
import { execute } from '../../commands/registry';
import BibliographyMenuButton from './BibliographyMenuButton';

/**
 * 学术工具栏（Phase 8 ACAD-02）：Academic 模式编辑器上方常驻条——引用 / 脚注 / 参考文献 / 公式。
 * 每按钮经 registry.execute(命令 id)（D-02 同源：与命令面板/键位同一命令，行为一致）。
 * 引用=academic.cite（含 Ctrl+Shift+Z）；脚注=academic.footnote；公式复用 para.math-block；
 * 参考文献=独立下拉（默认插入/刷新 + GB/T 7714 / APA / Vancouver 三式，ZOT-04）。
 */

const ITEMS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'academic.cite', label: '引用', icon: Quote },
  { id: 'academic.footnote', label: '脚注', icon: Superscript },
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
      <BibliographyMenuButton />
      <button
        type="button"
        title="公式"
        onClick={() => void execute('para.math-block')}
        className="flex items-center gap-1 rounded px-2 py-0.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]"
      >
        <Sigma size={14} strokeWidth={1.75} aria-hidden="true" />
        公式
      </button>
    </div>
  );
}
