import { StateEffect, type Text } from '@codemirror/state';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { onZoteroLibraryChanged, zoteroCslResilient } from '../../ipc/zotero';
import type { CslItem } from '../../types/zotero';
import { citationDocument } from '../citationDocument';
import { formatCitationDocument, type FormattedCitations } from '../cslFormat';
import { isBasicEditing } from '../documentBudget';
import { isComposing, queueAfterComposition, refreshLivePreview } from '../composition';

const publishCitations = StateEffect.define<null>();
const refreshListeners = new Set<() => void>();
export function refreshCitationPreviews(): void { for (const listener of refreshListeners) listener(); }

/** CSL metadata is untrusted; keep only inert inline typography in the rendered citation. */
function citationFragment(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  const result = document.createDocumentFragment();
  const append = (node: Node, parent: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) { parent.appendChild(document.createTextNode(node.textContent ?? '')); return; }
    if (!(node instanceof Element) && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    const tag = node instanceof Element ? node.tagName.toLowerCase() : '';
    if (['script', 'style', 'iframe', 'object', 'img', 'svg'].includes(tag)) return;
    const element = ['i', 'em', 'b', 'strong', 'sup', 'sub', 'span'].includes(tag) ? document.createElement(tag) : null;
    if (element && node instanceof HTMLElement && node.style.fontVariant === 'small-caps') element.style.fontVariant = 'small-caps';
    for (const child of node.childNodes) append(child, element ?? parent);
    if (element) parent.appendChild(element);
  };
  append(template.content, result);
  return result;
}

class CitationWidget extends WidgetType {
  readonly html: string;
  readonly source: string;
  constructor(html: string, source: string) { super(); this.html = html; this.source = source; }
  eq(other: CitationWidget): boolean { return other.html === this.html && other.source === this.source; }
  toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'cm-ink-citation';
    element.title = this.source;
    element.appendChild(citationFragment(this.html));
    return element;
  }
  ignoreEvent(): boolean { return false; }
}

class CitationPreview {
  decorations: DecorationSet = Decoration.none;
  private source: Text;
  private rendered: FormattedCitations | null = null;
  private error: string | null = null;
  private generation = 0;
  private retired = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private metadata: { keys: string; promise: Promise<CslItem[]> } | null = null;
  private readonly view: EditorView;
  private readonly unsubscribe: () => void;
  private readonly reload = () => {
    this.metadata = null;
    this.schedule();
    queueAfterComposition(this.view, 'citation-preview-invalidate', () => {
      if (!this.retired) this.view.dispatch({ effects: publishCitations.of(null) });
    });
  };

  constructor(view: EditorView) {
    this.view = view;
    this.source = view.state.doc;
    this.unsubscribe = onZoteroLibraryChanged(this.reload);
    refreshListeners.add(this.reload);
    this.schedule();
  }

  private schedule(): void {
    const request = ++this.generation;
    clearTimeout(this.timer);
    this.source = this.view.state.doc;
    this.rendered = null;
    this.error = null;
    if (!isComposing(this.view)) this.decorations = Decoration.none;
    if (isBasicEditing(this.view.state)) return;
    const model = citationDocument(this.view.state);
    if (!['markdown', 'richtext'].includes(model.language) || !model.clusters.length) return;
    if (!markdownLanguage.isActiveAt(this.view.state, model.clusters[0].from)) return;
    // Reuse in-flight metadata when only text, citation order or formatting changes.
    this.timer = setTimeout(() => { this.timer = undefined; void this.render(request); }, 120);
  }

  private async render(request: number): Promise<void> {
    const source = this.source;
    const current = () => !this.retired && request === this.generation && this.view.state.doc === source;
    if (!current()) return;
    const model = citationDocument(this.view.state);
    const keys = model.citations.map((citation) => citation.key).sort();
    const signature = JSON.stringify(keys);
    if (!this.metadata || this.metadata.keys !== signature) this.metadata = { keys: signature, promise: zoteroCslResilient(keys) };
    let rendered: FormattedCitations | null = null;
    let error: string | null = null;
    try {
      const items = await this.metadata.promise;
      if (!current()) return;
      rendered = await formatCitationDocument(items, model.clusters, model.style);
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
    if (!current()) return;
    queueAfterComposition(this.view, 'citation-preview', () => {
      if (!current()) return;
      this.rendered = rendered;
      this.error = error;
      this.view.dispatch({ effects: publishCitations.of(null) });
    });
  }

  private build(): DecorationSet {
    if (this.view.state.doc !== this.source || isBasicEditing(this.view.state)) return Decoration.none;
    const { state } = this.view;
    const model = citationDocument(state);
    if (!model.clusters.length || !markdownLanguage.isActiveAt(state, model.clusters[0].from)) return Decoration.none;
    const activeFrom = state.doc.lineAt(state.selection.main.from).from;
    const activeTo = state.doc.lineAt(state.selection.main.to).to;
    const clusters = this.rendered?.citations ?? (this.error ? model.clusters : []);
    const decorations = [];
    for (const cluster of clusters) {
      if (cluster.from <= activeTo && cluster.to >= activeFrom) continue;
      if (!this.view.visibleRanges.some((range) => cluster.to > range.from && cluster.from < range.to)) continue;
      if (this.error) decorations.push(Decoration.mark({ class: 'cm-ink-citation-error', attributes: { title: `引用未能排版：${this.error}` } }).range(cluster.from, cluster.to));
      else if ('html' in cluster && typeof cluster.html === 'string') decorations.push(Decoration.replace({ widget: new CitationWidget(cluster.html, state.doc.sliceString(cluster.from, cluster.to)) }).range(cluster.from, cluster.to));
    }
    return Decoration.set(decorations, true);
  }

  update(update: ViewUpdate): void {
    const refreshed = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshLivePreview)));
    if (!refreshed && isComposing(update.view)) {
      if (update.docChanged) {
        this.generation += 1;
        clearTimeout(this.timer);
        this.decorations = this.decorations.map(update.changes);
      }
      return;
    }
    if (update.docChanged || (refreshed && this.source !== update.state.doc)) this.schedule();
    if (update.selectionSet || update.viewportChanged || refreshed || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(publishCitations)))) {
      this.decorations = this.build();
    }
  }

  destroy(): void {
    this.retired = true;
    this.generation += 1;
    clearTimeout(this.timer);
    this.unsubscribe();
    refreshListeners.delete(this.reload);
  }
}

export const citationPreview = ViewPlugin.fromClass(CitationPreview, {
  decorations: (plugin) => plugin.decorations,
  provide: () => EditorView.theme({
    '.cm-ink-citation': { color: 'var(--cm-link)' },
    '.cm-ink-citation-error': { textDecoration: 'underline dotted var(--color-error)' },
  }),
});
