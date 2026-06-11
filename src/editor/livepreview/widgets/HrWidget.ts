import { WidgetType } from '@codemirror/view';

/**
 * 水平线 widget（行内层 / D-08 / UI-SPEC Layout Contract「水平线」）。
 *
 * 职责：把 `---` / `***` / `___`（HorizontalRule 节点）经 Decoration.replace 替换为真 `<hr>`
 * （1px var(--cm-hr) 贯穿 + md 留白）。光标进该行时由 inlinePlugin 整还原源码（D-07），不替换。
 *
 * 无状态、无内容差异：所有 HorizontalRule 渲染同一根 `<hr>`，故 eq 恒 true（CM6 复用旧 DOM 不重建）。
 * 非交互：ignoreEvent 返回 true，点击该行经光标行还原承接进编辑。
 *
 * 样式经 .cm-ink-hr class 消费 var(--cm-hr)，**永不硬编码色值**（同 highlightTheme.ts 纪律）。
 */
export class HrWidget extends WidgetType {
  /** 所有水平线渲染相同 `<hr>`：视为同一 widget，CM6 复用旧 DOM（防闪烁）。 */
  eq(): boolean {
    return true;
  }

  /** 水平线非交互：吞内部事件，编辑经光标行还原承接（D-07）。 */
  ignoreEvent(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const hr = document.createElement('hr');
    hr.className = 'cm-ink-hr';
    return hr;
  }
}
