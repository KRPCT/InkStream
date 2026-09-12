import { EditorView, WidgetType } from '@codemirror/view';
import { equationNumberText, equationReferenceText } from './markers';
import { navigateEquationTarget } from './navigation';

/** 包装既有三引擎 widget，保留其 DOM/编辑生命周期，只补派生的编号。 */
export class NumberedFormulaWidget extends WidgetType {
  constructor(readonly content: WidgetType, readonly ordinal: number, readonly label: string | null) { super(); }

  eq(other: NumberedFormulaWidget): boolean {
    return other.ordinal === this.ordinal && other.label === this.label
      && other.content.constructor === this.content.constructor && this.content.eq(other.content);
  }

  ignoreEvent(event: Event): boolean { return this.content.ignoreEvent(event); }

  private caption(dom: HTMLElement): void {
    dom.classList.add('cm-ink-numbered-equation');
    if (this.label) dom.dataset.equationLabel = this.label;
    else delete dom.dataset.equationLabel;
    let number = dom.querySelector<HTMLElement>(':scope > .cm-ink-equation-number');
    if (!number) {
      number = document.createElement('span');
      number.className = 'cm-ink-equation-number';
      dom.appendChild(number);
    }
    number.dataset.equationNumber = String(this.ordinal);
    number.textContent = equationNumberText(this.ordinal);
    number.setAttribute('aria-label', `公式编号 ${this.ordinal}`);
    number.title = this.label ? `引用：[[#eq:${this.label}]]` : '再次执行公式编号可生成此公式的引用标签';
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = this.content.toDOM(view);
    this.caption(dom);
    return dom;
  }

  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (!this.content.updateDOM(dom, view)) return false;
    this.caption(dom);
    return true;
  }

  destroy(dom: HTMLElement): void { this.content.destroy(dom); }
}

export class EquationReferenceWidget extends WidgetType {
  constructor(readonly label: string, readonly ordinal: number | null, readonly alias: string | null = null) { super(); }
  eq(other: EquationReferenceWidget): boolean { return other.label === this.label && other.ordinal === this.ordinal && other.alias === this.alias; }
  ignoreEvent(event: Event): boolean { return event.type !== 'mousedown'; }

  toDOM(view: EditorView): HTMLElement {
    const link = document.createElement('span');
    link.dataset.equationReference = this.label;
    link.className = this.ordinal === null ? 'cm-ink-equation-ref cm-ink-equation-ref-error' : 'cm-ink-equation-ref';
    link.textContent = this.ordinal === null ? `未解析：eq:${this.label}` : this.alias || equationReferenceText(this.ordinal);
    link.setAttribute('role', 'link');
    link.tabIndex = 0;
    link.title = `Ctrl/Cmd+点击跳转公式 · ${this.label}`;
    link.addEventListener('mousedown', (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      navigateEquationTarget(view, '#eq:' + this.label);
    });
    link.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      navigateEquationTarget(view, '#eq:' + this.label);
    });
    return link;
  }
}

export class EquationModeMarkerWidget extends WidgetType {
  eq(): boolean { return true; }
  toDOM(): HTMLElement {
    const marker = document.createElement('div');
    marker.className = 'cm-ink-equation-mode-marker';
    marker.setAttribute('aria-hidden', 'true');
    return marker;
  }
}

export const equationTheme = EditorView.theme({
  '.cm-ink-numbered-equation': { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: '0.75rem', alignItems: 'center' },
  '.cm-ink-numbered-equation > .cm-ink-formula-edit-header': { gridColumn: '1 / -1' },
  '.cm-ink-equation-number': { color: 'var(--text-muted)', fontSize: '0.9em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', paddingRight: '0.25rem' },
  '.cm-ink-equation-ref': { color: 'var(--text-accent)', textDecoration: 'underline', cursor: 'pointer' },
  '.cm-ink-equation-ref-error': { color: 'var(--color-error)', textDecorationStyle: 'dotted' },
  '.cm-ink-equation-mode-marker': { display: 'none' },
});
