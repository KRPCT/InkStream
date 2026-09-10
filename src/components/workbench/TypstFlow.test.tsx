import { EditorView } from '@codemirror/view';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseExtensions } from '../../editor/extensions';
import { __setTypstForTest, disposeTypst } from '../../editor/livepreview/typst/typstClient';
import { setFormulaEdit } from '../../editor/livepreview/formulaEditState';
import { setView } from '../../editor/viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { destroyTestView, makeTestView } from '../../test/composition';
import { installControlledTypstWorker, latestTypstWorker } from '../../test/typstWorker';
import RightPanel from './RightPanel';
import StatusBar from './StatusBar';

let view: EditorView | null = null;
const SOURCE = '$ x + y $';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><title>compiled formula</title><path d="M1 1L20 20"/></svg>';

beforeEach(() => {
  vi.useFakeTimers();
  disposeTypst();
  __setTypstForTest(false);
  installControlledTypstWorker();
  useEditorStore.setState(useEditorStore.getInitialState(), true);
  useSettingsStore.setState({ simpleMode: false, autosaveEnabled: false });
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.getState().setMode('academic');
  useWorkbenchStore.getState().setActiveTab('typstPreview');
  useEditorStore.getState().openTab({ path: 'formula.md', name: 'formula.md' });
  useEditorStore.getState().setActive('formula.md');
});

afterEach(async () => {
  cleanup();
  disposeTypst();
  await Promise.resolve();
  setView(null);
  destroyTestView(view);
  view = null;
  useSettingsStore.setState({ autosaveEnabled: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function mount(): void {
  view = makeTestView(`前文\n\n\`\`\`typst\n${SOURCE}\n\`\`\``, baseExtensions('markdown'));
  document.body.appendChild(view.dom);
  setView(view);
  render(<><RightPanel /><StatusBar /></>);
}

describe('Typst 编辑区、RightPanel、StatusBar 联动（Worker 传输桩）', () => {
  it('双栏编辑保留同一 textarea，异步编译后块右侧和 RightPanel 同时出图', async () => {
    mount();
    act(() => {
      view!.dispatch({ effects: setFormulaEdit.of({ blockFrom: view!.state.doc.toString().indexOf('```typst') }) });
    });
    const textarea = view!.dom.querySelector<HTMLTextAreaElement>('.cm-ink-formula-edit-src');
    expect(textarea).not.toBeNull();
    textarea!.setSelectionRange(2, 2);
    await act(async () => {
      latestTypstWorker().emit({ type: 'ready' });
      await vi.advanceTimersByTimeAsync(250);
      const worker = latestTypstWorker();
      const request = worker.compileRequests().find((item) => item.source === SOURCE);
      expect(request).toBeDefined();
      worker.emit({ type: 'result', id: request!.id, ok: true, svg: SVG });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view!.dom.querySelector('.cm-ink-formula-edit-src')).toBe(textarea);
    expect(textarea!.selectionStart).toBe(2);
    expect(view!.dom.querySelector('.cm-ink-formula-edit-preview svg title')?.textContent).toBe('compiled formula');
    expect(screen.getByTestId('tab-pane-typstPreview').querySelector('svg title')?.textContent).toBe('compiled formula');
  });

  it('同一次编译的 SVG 出现在编辑区和 RightPanel，状态栏显示已编译', async () => {
    mount();
    await act(async () => {
      latestTypstWorker().emit({ type: 'ready' });
      await vi.advanceTimersByTimeAsync(250);
      const worker = latestTypstWorker();
      const request = worker.compileRequests().find((item) => item.source === SOURCE);
      expect(request).toBeDefined();
      worker.emit({ type: 'result', id: request!.id, ok: true, svg: SVG });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(view!.dom.querySelector('.cm-ink-typst-render svg title')?.textContent).toBe('compiled formula');
    expect(screen.getByTestId('tab-pane-typstPreview').querySelector('svg title')?.textContent).toBe('compiled formula');
    expect(screen.getByTestId('typst-indicator')).toHaveTextContent('已编译');
  });

  it('编译失败在面板和状态栏可见，不继续显示成功结果', async () => {
    mount();
    await act(async () => {
      latestTypstWorker().emit({ type: 'ready' });
      await vi.advanceTimersByTimeAsync(250);
      const worker = latestTypstWorker();
      const request = worker.compileRequests().find((item) => item.source === SOURCE);
      expect(request).toBeDefined();
      worker.emit({ type: 'result', id: request!.id, ok: false, error: 'unknown variable: missing_symbol' });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('tab-pane-typstPreview')).toHaveTextContent('missing_symbol');
    expect(screen.getByTestId('typst-indicator')).toHaveTextContent('编译失败');
    expect(screen.getByTestId('tab-pane-typstPreview').querySelector('svg title')).toBeNull();
  });
});
