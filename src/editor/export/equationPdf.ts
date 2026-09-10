import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { pickExportPath } from '../../ipc/dialog';
import { writeBytesToPath } from '../../ipc/files';
import { useEditorStore } from '../../stores/useEditorStore';
import { showToast } from '../../stores/useToastStore';
import { isComposing } from '../composition';
import { isBasicEditing } from '../documentBudget';
import { currentDocumentNavigation, documentNavigationSignal } from '../editorState.navigation';
import { equationBodyStart } from '../equations/catalog';
import { formulaBlockFromNode, type FormulaBlock } from '../livepreview/formulaBlocks';
import { formulaEditState } from '../livepreview/formulaEditState';
import { loadMathjaxForExport } from '../livepreview/mathjaxLoader';
import { getView } from '../viewHandle';
import { compileSvgToPdf, equationPdfAbortError } from './equationPdfClient';
import { equationPdfLifecycle } from './equationPdfLifecycle';
import { equationSvg } from './equationSvg';

let activeExport: AbortController | null = null;

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason instanceof Error ? signal.reason : equationPdfAbortError());
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (result) => { signal.removeEventListener('abort', abort); resolve(result); },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

function currentBlock(view: EditorView, blockFrom?: number): FormulaBlock | null {
  const position = blockFrom ?? view.state.field(formulaEditState, false)?.blockFrom ?? view.state.selection.main.head;
  const tree = ensureSyntaxTree(view.state, Math.min(view.state.doc.length, position + 1), 50);
  if (!tree) return null;
  for (let node = tree.resolveInner(position, 1); ; ) {
    const block = formulaBlockFromNode(view.state, node);
    if (block) return block.from >= equationBodyStart(view.state.doc) ? block : null;
    if (!node.parent) return null;
    node = node.parent;
  }
}

function filename(path: string | null): string {
  const last = path?.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') || '未命名';
  return `${last}-formula.pdf`;
}

/** 当前源码快照的公式片段导出。所有异步阶段均归属于当前文档；不改正文、不借用整篇打印流程。 */
export async function exportEquationPdfAt(view: EditorView, blockFrom?: number): Promise<void> {
  if (isBasicEditing(view.state)) { showToast('warning', '基础编辑模式下暂停公式 PDF 导出，请先显式启用完整排版。'); return; }
  if (isComposing(view)) { showToast('warning', '请先完成当前输入，再导出公式 PDF。'); return; }
  const block = currentBlock(view, blockFrom);
  if (!block || block.engine !== 'latex') { showToast('warning', '请将光标放入 LaTeX 公式块，或使用该公式块的导出按钮。'); return; }
  if (!block.source.trim()) { showToast('warning', '当前 LaTeX 公式为空。'); return; }
  if (block.closingFrom === null) { showToast('warning', 'LaTeX 公式块尚未闭合，请先补全结束标记。'); return; }
  if (activeExport) { showToast('warning', '正在导出公式 PDF，请等待当前导出完成。'); return; }

  const doc = view.state.doc;
  const path = useEditorStore.getState().activePath;
  const controller = new AbortController();
  activeExport = controller;
  const navigation = documentNavigationSignal(currentDocumentNavigation());
  const lifecycle = view.plugin(equationPdfLifecycle)?.signal;
  const abort = (): void => controller.abort(equationPdfAbortError());
  navigation.addEventListener('abort', abort, { once: true });
  lifecycle?.addEventListener('abort', abort, { once: true });
  if (navigation.aborted || lifecycle?.aborted) abort();
  const current = (): void => {
    if (controller.signal.aborted || getView() !== view || view.state.doc !== doc || useEditorStore.getState().activePath !== path) throw equationPdfAbortError();
  };
  let loadingTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    current();
    loadingTimeout = setTimeout(() => controller.abort(new Error('LaTeX 公式转换器加载超时，请重试')), 30_000);
    const convert = await abortable(loadMathjaxForExport(), controller.signal);
    current();
    const image = equationSvg(convert(block.source, true));
    clearTimeout(loadingTimeout);
    loadingTimeout = undefined;
    const pdf = await compileSvgToPdf(image.svg, { ...image, signal: controller.signal });
    current();
    const outputPath = await abortable(pickExportPath(filename(path), 'pdf'), controller.signal);
    current();
    if (!outputPath) return;
    await writeBytesToPath(outputPath, pdf);
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) {
      showToast('error', `公式 PDF 导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    if (loadingTimeout !== undefined) clearTimeout(loadingTimeout);
    navigation.removeEventListener('abort', abort);
    lifecycle?.removeEventListener('abort', abort);
    if (activeExport === controller) activeExport = null;
  }
}

export async function exportEquationPdf(): Promise<void> {
  const view = getView();
  if (!view) { showToast('warning', '请先打开包含 LaTeX 公式的文档。'); return; }
  await exportEquationPdfAt(view);
}
