import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import type { Text } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { emptyTypstSnapshot, useTypstStore, type TypstPhase, type TypstPreviewBlock } from '../../../stores/useTypstStore';
import { isBasicEditing } from '../../documentBudget';
import { isComposing, queueAfterComposition, refreshLivePreview } from '../../composition';
import { getView } from '../../viewHandle';
import { equationCatalog } from '../../equations/catalog';
import { collectFormulaBlocks } from '../formulaBlocks';
import { cancelTypstRequests, compileTypst, disposeTypst, ERROR_SENTINEL, getCachedSvg, setTypstActiveSources, typstReady } from './typstClient';
import { markTypstDocumentManaged } from './typstDocumentPresence';

let nextSession = 0;

class TypstDocument {
  readonly session = ++nextSession;
  private revision = 0;
  private generation = 0;
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private alive = true;
  private blocks: TypstPreviewBlock[] = [];
  private parsedComplete = true;

  constructor(private readonly view: EditorView) {
    markTypstDocumentManaged(view, true);
    useTypstStore.setState({ session: this.session, revision: 0, phase: 'idle', blocks: [] }, true);
    this.scan();
  }

  update(update: ViewUpdate): void {
    const budgetChanged = isBasicEditing(update.startState) !== isBasicEditing(update.state);
    const parsed = syntaxTree(update.startState) !== syntaxTree(update.state);
    if (!update.docChanged && !budgetChanged && !parsed) return;
    if (update.docChanged) ++this.revision;
    this.cancel();
    this.blocks = [];
    if (isBasicEditing(update.state)) {
      this.publish('paused');
      disposeTypst();
      return;
    }
    this.publish('compiling');
    if (isComposing(this.view)) {
      queueAfterComposition(this.view, 'typst-document', () => { if (this.alive) this.scan(); });
    } else {
      this.timer = setTimeout(() => { this.timer = undefined; this.scan(); }, update.docChanged ? 200 : 0);
    }
  }

  retry(): void {
    this.cancel();
    this.scan();
  }

  private cancel(): void {
    ++this.generation;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller.abort();
    this.controller = new AbortController();
    cancelTypstRequests(this.view);
  }

  private owns(doc: Text, generation: number): boolean {
    return this.alive && useTypstStore.getState().session === this.session && this.generation === generation && this.view.state.doc === doc;
  }

  private phase(): TypstPhase {
    if (this.blocks.some((block) => block.status === 'loading')) return 'loading';
    if (this.blocks.some((block) => block.status === 'compiling')) return 'compiling';
    if (this.blocks.some((block) => block.status === 'error')) return 'error';
    if (this.blocks.some((block) => block.status === 'ready')) return this.parsedComplete ? 'ready' : 'partial';
    return 'idle';
  }

  private publish(phase = this.phase()): void {
    if (!this.alive || useTypstStore.getState().session !== this.session) return;
    useTypstStore.setState({ session: this.session, revision: this.revision, phase, blocks: this.blocks }, true);
  }

  private refresh(doc: Text, generation: number): void {
    queueAfterComposition(this.view, 'typst-document-preview', () => {
      if (this.owns(doc, generation)) this.view.dispatch({ effects: refreshLivePreview.of(null) });
    });
  }

  private scan(): void {
    if (!this.alive || useTypstStore.getState().session !== this.session) return;
    if (isBasicEditing(this.view.state)) {
      this.blocks = [];
      this.publish('paused');
      return;
    }
    const doc = this.view.state.doc;
    const generation = this.generation;
    this.parsedComplete = syntaxTreeAvailable(this.view.state, doc.length);
    const equations = equationCatalog(this.view.state);
    this.blocks = collectFormulaBlocks(this.view.state).filter((block) => block.engine === 'typst').map<TypstPreviewBlock>((block) => {
      const cached = getCachedSvg(block.source);
      const svg = cached && !cached.startsWith(ERROR_SENTINEL) ? cached : null;
      const equation = equations.enabled ? equations.byFrom.get(block.from) : undefined;
      return { ...block, equationNumber: equation?.ordinal, equationLabel: equation?.label ?? undefined, status: block.source.trim() === '' ? 'empty' : svg ? 'ready' : typstReady() ? 'compiling' : 'loading', svg, error: null };
    });
    setTypstActiveSources(this.blocks.map((block) => block.source));
    this.publish();
    for (let index = 0; index < this.blocks.length; index += 1) {
      const block = this.blocks[index];
      if (block.status === 'empty' || block.status === 'ready') continue;
      void compileTypst(block.source, {
        signal: this.controller.signal,
        onProgress: (status) => {
          if (!this.owns(doc, generation)) return;
          this.blocks = this.blocks.map((item, at) => at === index ? { ...item, status } : item);
          this.publish();
        },
      }).then((svg) => {
        if (!this.owns(doc, generation)) return;
        this.blocks = this.blocks.map((item, at) => at === index ? { ...item, status: 'ready', svg, error: null } : item);
        this.publish();
        this.refresh(doc, generation);
      }, (error: unknown) => {
        if (!this.owns(doc, generation) || (error instanceof Error && error.name === 'AbortError')) return;
        this.blocks = this.blocks.map((item, at) => at === index ? { ...item, status: 'error', svg: null, error: error instanceof Error ? error.message : String(error) } : item);
        this.publish();
        this.refresh(doc, generation);
      });
    }
    if (this.blocks.length === 0) disposeTypst();
  }

  destroy(): void {
    this.alive = false;
    this.cancel();
    markTypstDocumentManaged(this.view, false);
    if (useTypstStore.getState().session === this.session) {
      useTypstStore.setState(emptyTypstSnapshot, true);
      disposeTypst();
    }
  }
}

/** 顶层保活，基础档仅发布暂停状态；setState 销毁旧会话，不让旧结果写入新文档。 */
export const typstCompilationExtension = ViewPlugin.fromClass(TypstDocument);
export function retryTypstDocument(): void { getView()?.plugin(typstCompilationExtension)?.retry(); }
