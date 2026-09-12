import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { comparisonDisplayText, type CompareRange } from '../diff/compareText';

/** Comparison views never register as the application's editable document view. */
export function createComparisonView(parent: HTMLElement, text: string, ranges: CompareRange[], side: 'old' | 'new', label: string): EditorView {
  text = comparisonDisplayText(text);
  const decorations = Decoration.set(ranges.map(({ from, to }) => Decoration.mark({ class: `branch-compare-${side}` }).range(from, to)), true);
  return new EditorView({ parent, state: EditorState.create({ doc: text, extensions: [
    EditorState.readOnly.of(true), EditorView.editable.of(false),
    EditorState.transactionFilter.of((transaction) => transaction.docChanged ? [] : transaction), lineNumbers(),
    EditorView.contentAttributes.of({ 'aria-label': label, 'aria-readonly': 'true', tabindex: '0' }),
    keymap.of([...searchKeymap, ...defaultKeymap]), search(),
    EditorView.decorations.of(decorations),
    EditorView.theme({
      '&': { height: '100%', color: 'var(--text-normal)', background: 'var(--background-primary)' },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-text)' },
      '.cm-content': { padding: '12px', whiteSpace: 'pre' },
      '.cm-gutters': { background: 'var(--background-secondary)', color: 'var(--text-muted)' },
      '.branch-compare-old': { background: 'var(--graph-diff-del-bg)' },
      '.branch-compare-new': { background: 'var(--graph-diff-add-bg)' },
    }),
  ] }) });
}

export function locateComparison(view: EditorView, range: CompareRange): void {
  view.dispatch({ selection: { anchor: range.from, head: range.to }, effects: EditorView.scrollIntoView(range.from, { y: 'center' }) });
}

/** A repeated sentence has no unique correspondence; never jump to an arbitrary occurrence. */
export function uniqueComparisonRange(text: string, snippet: string): CompareRange | null {
  text = comparisonDisplayText(text);
  snippet = comparisonDisplayText(snippet);
  if (!snippet.trim()) return null;
  const from = text.indexOf(snippet);
  return from < 0 || text.indexOf(snippet, from + 1) >= 0 ? null : { from, to: from + snippet.length };
}
