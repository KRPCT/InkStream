import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBuiltinCommands } from '../../commands/builtins';
import { execute, getAll } from '../../commands/registry';
import AcademicToolbar from '../../components/workbench/AcademicToolbar';
import MenuBar from '../../components/workbench/MenuBar';
import { pickExportPath } from '../../ipc/dialog';
import { writeBytesToPath } from '../../ipc/files';
import { useEditorStore } from '../../stores/useEditorStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useToastStore } from '../../stores/useToastStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { destroyTestView, makeTestView } from '../../test/composition';
import { ControlledTypstWorker, installControlledTypstWorker, latestTypstWorker } from '../../test/typstWorker';
import { LARGE_DOCUMENT_UNITS } from '../documentBudget';
import { baseExtensions } from '../extensions';
import { setFormulaEdit } from '../livepreview/formulaEditState';
import { __setMathjaxConvertForTest } from '../livepreview/mathjaxLoader';
import { __setTypstForTest, disposeTypst } from '../livepreview/typst/typstClient';
import { setView } from '../viewHandle';

const { strictConvert, loadStrict } = vi.hoisted(() => ({
  strictConvert: vi.fn<(source: string, display: boolean) => HTMLElement>(),
  loadStrict: vi.fn(),
}));

vi.mock('../livepreview/mathjaxLoader', async (importOriginal) => ({
  ...await importOriginal<typeof import('../livepreview/mathjaxLoader')>(),
  loadMathjaxForExport: loadStrict,
}));
vi.mock('../../ipc/dialog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../ipc/dialog')>(),
  pickExportPath: vi.fn(),
}));
vi.mock('../../ipc/files', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../ipc/files')>(),
  writeBytesToPath: vi.fn(),
}));

const COMMAND = 'academic.export-equation-pdf';
const FIRST = 'a^2+b^2=c^2';
const CURRENT = '\\frac{E}{m}=c^2';
const DOC = ['# 论文', '```latex', FIRST, '```', '', '```latex', CURRENT, '```'].join('\n');

interface PdfRequest {
  type: 'export-svg-pdf';
  svg: string;
  widthPt: number;
  heightPt: number;
}

// 只验证用户入口与二进制传输。真实公式编译、页尺寸与矢量字形须另做原生 WASM 验收。
function transportPdf(): Uint8Array {
  const stream = '0 0 24 12 re S\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 24 12] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

function svgFor(source: string): HTMLElement {
  const mount = document.createElement('span');
  mount.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -800 2000 1000" width="4ex" height="2ex"><title></title><defs><path id="glyph-a" d="M0 0L100 100"/></defs><use href="#glyph-a"/></svg>';
  mount.querySelector('title')!.textContent = source;
  return mount;
}

let view: EditorView | null = null;
let disposeCommands: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  disposeTypst();
  __setTypstForTest(false);
  installControlledTypstWorker();
  __setMathjaxConvertForTest((source) => svgFor(source));
  strictConvert.mockReset().mockImplementation((source) => svgFor(source));
  loadStrict.mockReset().mockResolvedValue(strictConvert);
  vi.mocked(pickExportPath).mockReset().mockResolvedValue('C:/formula-fragment.pdf');
  vi.mocked(writeBytesToPath).mockReset().mockResolvedValue(null);
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useSettingsStore.setState({ autosaveEnabled: false, simpleMode: false });
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.getState().setMode('academic');
  useEditorStore.getState().openTab({ path: 'equations.md', name: 'equations.md' });
  useEditorStore.getState().setActive('equations.md');
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
  disposeCommands = registerBuiltinCommands();
});

afterEach(async () => {
  cleanup();
  setView(null);
  destroyTestView(view);
  view = null;
  disposeCommands?.();
  disposeCommands = undefined;
  disposeTypst();
  await Promise.resolve();
  __setMathjaxConvertForTest(null);
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
  useSettingsStore.setState({ autosaveEnabled: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function open(doc = DOC): EditorView {
  view = makeTestView(doc, baseExtensions('markdown', doc.length));
  document.body.appendChild(view.dom);
  setView(view);
  const sourceFrom = doc.indexOf(CURRENT);
  if (sourceFrom >= 0) view.dispatch({ selection: { anchor: sourceFrom + 2 } });
  return view;
}

function requestOf(worker: ControlledTypstWorker): PdfRequest {
  const request = worker.sent.find((value): value is PdfRequest =>
    typeof value === 'object' && value !== null && 'type' in value && value.type === 'export-svg-pdf',
  );
  expect(request).toBeDefined();
  return request!;
}

async function beginCommand() {
  const pending = execute(COMMAND);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const worker = latestTypstWorker();
  return { pending, worker, request: requestOf(worker) };
}

async function finish(worker: ControlledTypstWorker, pending?: Promise<void>, pdf = transportPdf()) {
  await act(async () => {
    worker.emit({ type: 'pdf-result', ok: true, pdf });
    await pending;
    await vi.advanceTimersByTimeAsync(0);
  });
}

const messages = () => useToastStore.getState().toasts.map((toast) => toast.message).join('\n');

describe('LaTeX 公式 PDF 片段的用户入口', () => {
  it('学术工具栏导出当前第二个公式为自包含 SVG，再保存 Worker 返回的 PDF 字节', async () => {
    open();
    const original = view!.state.doc;
    render(<AcademicToolbar />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '公式 PDF' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    const worker = latestTypstWorker();
    const request = requestOf(worker);
    expect(strictConvert).toHaveBeenCalledTimes(1);
    expect(strictConvert).toHaveBeenCalledWith(CURRENT, true);
    const svg = new DOMParser().parseFromString(request.svg, 'image/svg+xml');
    expect(svg.querySelector('title')?.textContent).toBe(CURRENT);
    const reference = svg.querySelector('use')?.getAttribute('href');
    expect(reference).toMatch(/^#/);
    expect(svg.getElementById(reference!.slice(1))?.tagName).toBe('path');
    expect(request.widthPt).toBe(24);
    expect(request.heightPt).toBe(12);
    expect(pickExportPath).not.toHaveBeenCalled();
    const pdf = transportPdf();
    await finish(worker, undefined, pdf);
    expect(pickExportPath).toHaveBeenCalledWith('equations-formula.pdf', 'pdf');
    expect(writeBytesToPath).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(writeBytesToPath).mock.calls[0];
    expect(saved[0]).toBe('C:/formula-fragment.pdf');
    expect(Array.from(saved[1])).toEqual(Array.from(pdf));
    expect(worker.terminate).toHaveBeenCalled();
    expect(view!.state.doc).toBe(original);
  });

  it('文件导出菜单提供同一公式命令，原整篇 PDF 命令仍可用', async () => {
    open();
    render(<MenuBar />);
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '文件' })); });
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '导出为' })); });
    expect(screen.getByRole('menuitem', { name: 'PDF…' })).toBeEnabled();
    expect(getAll().find((command) => command.id === 'file.export-pdf')).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: '公式 PDF 片段…' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    const worker = latestTypstWorker();
    requestOf(worker);
    await finish(worker);
    expect(writeBytesToPath).toHaveBeenCalledTimes(1);
  });

  it('公式块悬浮入口使用点击块，双栏编辑时命令使用正在编辑的块', async () => {
    open();
    view!.dispatch({ selection: { anchor: 0 } });
    const blockButtons = view!.dom.querySelectorAll<HTMLButtonElement>('.cm-ink-latex [aria-label="导出公式 PDF"]');
    expect(blockButtons).toHaveLength(2);
    await act(async () => {
      fireEvent.click(blockButtons[1]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(strictConvert).toHaveBeenLastCalledWith(CURRENT, true);
    await finish(latestTypstWorker());
    view!.dispatch({ effects: setFormulaEdit.of({ blockFrom: DOC.indexOf('```latex') }) });
    const next = await beginCommand();
    expect(strictConvert).toHaveBeenLastCalledWith(FIRST, true);
    await finish(next.worker, next.pending);
    expect(writeBytesToPath).toHaveBeenCalledTimes(2);
  });

  it('保存对话框取消时不写文件，也不显示成功提示', async () => {
    open();
    vi.mocked(pickExportPath).mockResolvedValueOnce(null);
    const { worker, pending } = await beginCommand();
    await finish(worker, pending);
    expect(pickExportPath).toHaveBeenCalledTimes(1);
    expect(writeBytesToPath).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('严格 LaTeX 转换失败显示原始错误且不启动 PDF Worker 或保存', async () => {
    open();
    strictConvert.mockImplementationOnce(() => { throw new Error('Undefined control sequence \\doesnotexist'); });
    await act(async () => { await execute(COMMAND); });
    expect(strictConvert).toHaveBeenCalledTimes(1);
    expect(strictConvert).toHaveBeenCalledWith(CURRENT, true);
    expect(messages()).toContain('Undefined control sequence');
    expect(ControlledTypstWorker.instances).toHaveLength(0);
    expect(pickExportPath).not.toHaveBeenCalled();
    expect(writeBytesToPath).not.toHaveBeenCalled();
  });

  it.each(['merror', 'geometry'] as const)('转换器返回 %s 时也拒绝生成 PDF', async (failure) => {
    open();
    strictConvert.mockImplementationOnce((source) => {
      const mount = svgFor(source);
      if (failure === 'merror') {
        mount.querySelector('svg')!.setAttribute('data-mjx-error', 'Unknown environment');
      } else mount.querySelector('svg')!.setAttribute('viewBox', '0 0 NaN 1000');
      return mount;
    });
    await act(async () => { await execute(COMMAND); });
    expect(messages()).toContain(failure === 'merror' ? 'Unknown environment' : 'SVG 尺寸无效');
    expect(ControlledTypstWorker.instances).toHaveLength(0);
    expect(pickExportPath).not.toHaveBeenCalled();
    expect(writeBytesToPath).not.toHaveBeenCalled();
  });

  it.each([new Uint8Array(), new TextEncoder().encode('<svg>not a PDF</svg>')])('空或错误 PDF 结果不能作为成功保存', async (invalidPdf) => {
    open();
    const { worker, pending } = await beginCommand();
    await finish(worker, pending, invalidPdf);
    expect(pickExportPath).not.toHaveBeenCalled();
    expect(writeBytesToPath).not.toHaveBeenCalled();
    expect(messages()).toMatch(/PDF.*(?:无效|为空|失败)/);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it.each(['edit', 'switch'] as const)('编译期间 %s 文档立即终止 Worker，迟到结果不能写旧公式', async (action) => {
    open();
    const { worker, pending } = await beginCommand();
    await act(async () => {
      if (action === 'edit') view!.dispatch({ changes: { from: DOC.indexOf(CURRENT), insert: 'x+' } });
      else view!.setState(EditorState.create({ doc: '# 另一篇文档', extensions: baseExtensions('markdown') }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(worker.terminate).toHaveBeenCalled();
    await finish(worker, pending);
    expect(pickExportPath).not.toHaveBeenCalled();
    expect(writeBytesToPath).not.toHaveBeenCalled();
  });

  it('转换器尚未加载时换文档立即结束旧导出，新文档可导出且迟到模块不编译旧公式', async () => {
    open();
    let resolveOld!: (convert: typeof strictConvert) => void;
    loadStrict.mockReturnValueOnce(new Promise<typeof strictConvert>((resolve) => { resolveOld = resolve; }));
    const old = execute(COMMAND);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(loadStrict).toHaveBeenCalledTimes(1);
    const next = '# 新文档\n\n```latex\n' + CURRENT + '\n```';
    await act(async () => {
      view!.setState(EditorState.create({ doc: next, extensions: baseExtensions('markdown') }));
      view!.dispatch({ selection: { anchor: next.indexOf(CURRENT) + 1 } });
      await old;
    });
    const current = await beginCommand();
    await finish(current.worker, current.pending);
    await act(async () => { resolveOld(strictConvert); await vi.advanceTimersByTimeAsync(0); });
    expect(ControlledTypstWorker.instances).toHaveLength(1);
    expect(strictConvert).toHaveBeenCalledTimes(1);
    expect(writeBytesToPath).toHaveBeenCalledTimes(1);
  });

  it('转换器加载超时释放导出状态，重试可进入 PDF Worker', async () => {
    open();
    loadStrict.mockReturnValueOnce(new Promise(() => undefined));
    const pending = execute(COMMAND);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); await pending; });
    expect(messages()).toContain('LaTeX 公式转换器加载超时');
    expect(ControlledTypstWorker.instances).toHaveLength(0);
    const retry = await beginCommand();
    await finish(retry.worker, retry.pending);
    expect(writeBytesToPath).toHaveBeenCalledTimes(1);
  });

  it('原子写入失败报告实际原因，原文不变且下一次可以重新导出', async () => {
    open();
    const original = view!.state.doc;
    vi.mocked(writeBytesToPath).mockRejectedValueOnce(new Error('Access is denied'));
    const first = await beginCommand();
    await finish(first.worker, first.pending);
    expect(messages()).toContain('Access is denied');
    expect(view!.state.doc).toBe(original);
    const retry = await beginCommand();
    await finish(retry.worker, retry.pending);
    expect(writeBytesToPath).toHaveBeenCalledTimes(2);
    expect(retry.worker).not.toBe(first.worker);
  });

  it.each(['worker', 'timeout'] as const)('%s 失败终止 Worker 并允许下一次重试', async (failure) => {
    open();
    const failed = await beginCommand();
    await act(async () => {
      if (failure === 'worker') failed.worker.fail('WASM allocation failed');
      else await vi.advanceTimersByTimeAsync(45_000);
      await failed.pending;
    });
    expect(messages()).toContain(failure === 'worker' ? 'WASM allocation failed' : '编译超时');
    expect(failed.worker.terminate).toHaveBeenCalled();
    expect(writeBytesToPath).not.toHaveBeenCalled();
    const retry = await beginCommand();
    await finish(retry.worker, retry.pending);
    expect(writeBytesToPath).toHaveBeenCalledTimes(1);
  });

  it('光标不在 LaTeX 块时提示选择公式；基础编辑档拒绝完整扫描', async () => {
    open();
    view!.dispatch({ selection: { anchor: 1 } });
    await act(async () => { await execute(COMMAND); });
    expect(messages()).toMatch(/(?:选择|光标|LaTeX)/);
    const large = '文'.repeat(LARGE_DOCUMENT_UNITS) + '\n\n' + DOC;
    view!.setState(EditorState.create({ doc: large, extensions: baseExtensions('markdown', large.length) }));
    const stringify = vi.spyOn(view!.state.doc, 'toString');
    await act(async () => { await execute(COMMAND); });
    expect(messages()).toContain('基础编辑');
    expect(stringify).not.toHaveBeenCalled();
    expect(loadStrict).not.toHaveBeenCalled();
    expect(ControlledTypstWorker.instances).toHaveLength(0);
    expect(writeBytesToPath).not.toHaveBeenCalled();
  });
});
