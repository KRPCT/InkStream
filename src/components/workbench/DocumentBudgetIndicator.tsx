import type { DocumentBudget } from '../../types/editor';
import { setDocumentEditingMode } from '../../editor/documentBudgetActions';
import { getView } from '../../editor/viewHandle';

const BUTTON_CLS = 'h-full shrink-0 px-2 text-[12px] hover:bg-[var(--background-modifier-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';

export default function DocumentBudgetIndicator({ budget }: { budget: DocumentBudget }) {
  const basic = budget.mode === 'basic';
  const detail = basic
    ? '实时排版、语法高亮、大纲、引用、字数与场景概要已暂停。正文仍可完整编辑、搜索和保存。'
    : '此文档已由你启用完整排版；可随时恢复基础编辑，正文、选区与撤销历史会保留。';
  return (
    <div data-testid="document-budget-indicator" className="flex h-full min-w-0 items-center border-l border-[var(--background-modifier-border)]" title={detail}>
      <span className="truncate px-2 text-[var(--text-muted)]">
        {basic ? (budget.large ? '大文档模式 · 实时排版与派生信息已暂停' : '基础编辑 · 实时排版与派生信息已暂停') : '大文档完整排版'}
      </span>
      <button type="button" className={BUTTON_CLS} onClick={() => {
        const view = getView();
        if (view) setDocumentEditingMode(view, basic ? 'full' : 'basic');
      }}>
        {basic ? '启用完整排版（可能较慢）' : '恢复基础编辑'}
      </button>
    </div>
  );
}
