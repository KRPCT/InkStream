import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBuiltinCommands } from '../commands/builtins';
import { execute } from '../commands/registry';
import AcademicToolbar from '../components/workbench/AcademicToolbar';
import { pickExportPath } from '../ipc/dialog';
import { writeFileToPath } from '../ipc/files';
import { useEditorStore } from '../stores/useEditorStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useToastStore } from '../stores/useToastStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { destroyTestView, makeTestView } from '../test/composition';
import { installControlledTypstWorker } from '../test/typstWorker';
import { LARGE_DOCUMENT_UNITS } from './documentBudget';
import { baseExtensions } from './extensions';
import { __setKatexForTest } from './livepreview/mathLoader';
import { __setMathjaxConvertForTest } from './livepreview/mathjaxLoader';
import { __setTypstForTest, disposeTypst } from './livepreview/typst/typstClient';
import { setView } from './viewHandle';

vi.mock('../ipc/dialog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../ipc/dialog')>(),
  pickExportPath: vi.fn(async () => 'C:/temporary-equations.html'),
}));
vi.mock('../ipc/files', async (importOriginal) => ({
  ...await importOriginal<typeof import('../ipc/files')>(),
  writeFileToPath: vi.fn(async () => undefined),
}));

const ENABLED = '<!-- equation-numbering -->';
const LATEX = '```latex\nE=mc^2\n```';
const TYPST = ':::typst\n$ x^2 + y^2 = z^2 $\n:::';
const MATH = '$$z = x + y$$';
const label = (name: string) => `<!-- equation:${name} -->`;
const refs = '见 [[#eq:energy]] 与 [[#eq:geometry]]。';
const labelled = () => [ENABLED, LATEX, label('energy'), TYPST, label('geometry'), refs].join('\n\n');
const fakeKatex = {
  render(source: string, mount: HTMLElement) { mount.textContent = source; },
  renderToString(source: string) { return `<math>${source}</math>`; },
  ParseError: class extends Error {},
  version: 'test-transport-only',
} as unknown as Parameters<typeof __setKatexForTest>[0];

let view: EditorView | null = null;
let disposeCommands: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  disposeTypst();
  __setTypstForTest(false);
  installControlledTypstWorker();
  __setKatexForTest(fakeKatex);
  __setMathjaxConvertForTest((source) => {
    const mount = document.createElement('span');
    mount.textContent = source;
    return mount;
  });
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useSettingsStore.setState({ autosaveEnabled: false, simpleMode: false, exportBrandingFooter: false });
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
  __setKatexForTest(null);
  __setMathjaxConvertForTest(null);
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
  useSettingsStore.setState({ autosaveEnabled: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function open(doc: string): EditorView {
  view = makeTestView(doc, baseExtensions('markdown'));
  document.body.appendChild(view.dom);
  setView(view);
  return view;
}
const numbers = (): string[] => [...view!.dom.querySelectorAll('[data-equation-number]')].map((node) => node.textContent ?? '');
const referenceText = (name: string): string | null | undefined => view!.dom.querySelector(`[data-equation-reference="${name}"]`)?.textContent;

describe('公式编号的用户入口', () => {
  it('工具栏给三种公式加稳定标签，重复执行不改正文，单步撤销恢复原文', async () => {
    const original = ['# 论文', LATEX, TYPST, MATH].join('\n\n');
    open(original);
    render(<AcademicToolbar />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '公式编号' })); });
    const numbered = view!.state.doc.toString();
    expect(numbered).toContain(ENABLED);
    expect(numbered).toContain(LATEX);
    expect(numbered).toContain(TYPST);
    const labels = [...numbered.matchAll(/<!-- equation:([^>]+) -->/g)].map((match) => match[1]);
    expect(labels).toHaveLength(3);
    expect(new Set(labels).size).toBe(3);
    expect(numbers()).toEqual(['（1）', '（2）', '（3）']);
    await act(async () => { await execute('academic.number-equations'); });
    expect(view!.state.doc.toString()).toBe(numbered);
    await act(async () => { await execute('edit.undo'); });
    expect(view!.state.doc.toString()).toBe(original);
  });

  it('按文档重排与插入新公式后编号自动更新，原标签和引用身份不变', async () => {
    open(labelled());
    expect(referenceText('energy')).toBe('式（1）');
    expect(referenceText('geometry')).toBe('式（2）');
    const reordered = [ENABLED, TYPST, label('geometry'), MATH, LATEX, label('energy'), refs].join('\n\n');
    await act(async () => { view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: reordered } }); });
    expect(numbers()).toEqual(['（1）', '（2）', '（3）']);
    expect(referenceText('energy')).toBe('式（3）');
    expect(referenceText('geometry')).toBe('式（1）');
    expect(view!.state.doc.toString()).toBe(reordered);
  });

  it('删除公式按钮同时删除其标签，其余公式重新编号且引用仍指向原公式', async () => {
    open(labelled());
    const remove = view!.dom.querySelector<HTMLButtonElement>('.cm-ink-latex [aria-label="删除公式块"]');
    expect(remove).not.toBeNull();
    await act(async () => { fireEvent.click(remove!); });
    expect(view!.state.doc.toString()).not.toContain(label('energy'));
    expect(view!.state.doc.toString()).toContain(label('geometry'));
    expect(referenceText('geometry')).toBe('式（1）');
    expect(view!.dom.querySelector('[data-equation-reference="energy"]')).toHaveTextContent('未解析');
  });

  it.each([
    { name: '重复', doc: [ENABLED, LATEX, label('same'), TYPST, label('same')].join('\n\n'), warning: '重复' },
    { name: '非法', doc: [ENABLED, LATEX, label('bad label')].join('\n\n'), warning: '非法' },
    { name: '孤立', doc: [ENABLED, label('detached'), '普通段落'].join('\n\n'), warning: '未关联公式' },
  ])('$name 标签被明确提示，命令不静默改标签或正文', async ({ doc, warning }) => {
    open(doc);
    await act(async () => { await execute('academic.number-equations'); });
    expect(view!.state.doc.toString()).toBe(doc);
    expect(useToastStore.getState().toasts.some((toast) => toast.message.includes(warning))).toBe(true);
  });

  it('Ctrl 点击公式引用定位当前公式源码，不打开同名文件', async () => {
    open(labelled());
    const target = view!.dom.querySelector<HTMLElement>('[data-equation-reference="geometry"]');
    expect(target).not.toBeNull();
    await act(async () => { fireEvent.mouseDown(target!, { ctrlKey: true, bubbles: true }); });
    expect(view!.state.doc.sliceString(view!.state.selection.main.from, view!.state.selection.main.to)).toBe('$ x^2 + y^2 = z^2 $');
    expect(useEditorStore.getState().activePath).toBe('equations.md');
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it('序列化后重开仍使用同一标签，HTML 导出包含对应编号、锚点和引用链接', async () => {
    const serialized = labelled();
    open(serialized);
    view!.setState(EditorState.create({ doc: serialized, extensions: baseExtensions('markdown') }));
    expect(referenceText('energy')).toBe('式（1）');
    await act(async () => { await execute('file.export-html'); });
    expect(pickExportPath).toHaveBeenCalledWith('equations.html', 'html');
    const call = vi.mocked(writeFileToPath).mock.calls.at(-1);
    expect(call).toBeDefined();
    const html = new DOMParser().parseFromString(call![1], 'text/html');
    const energy = html.querySelector<HTMLElement>('[data-equation-label="energy"]');
    const geometry = html.querySelector<HTMLElement>('[data-equation-label="geometry"]');
    expect(energy?.querySelector('.equation-number')?.textContent).toBe('（1）');
    expect(geometry?.querySelector('.equation-number')?.textContent).toBe('（2）');
    const link = html.querySelector<HTMLAnchorElement>('[data-equation-reference="geometry"]');
    expect(link?.textContent).toBe('式（2）');
    expect(link?.getAttribute('href')).toBe('#' + geometry?.id);
    expect(html.body.textContent).not.toContain('<!-- equation');
  });

  it('大文档基础档拒绝完整编号扫描，正文与模式保持原状', async () => {
    open('字'.repeat(LARGE_DOCUMENT_UNITS) + '\n\n' + LATEX);
    const text = view!.state.doc;
    const stringify = vi.spyOn(text, 'toString');
    await act(async () => { await execute('academic.number-equations'); });
    expect(view!.state.doc).toBe(text);
    expect(stringify).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.some((toast) => toast.message.includes('基础编辑'))).toBe(true);
  });
});
