import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openFileAndLocate } from './fileOpenFlow';
import { beginDocumentNavigation } from './editorState.navigation';
import { setView } from './viewHandle';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';

let view: EditorView;
let frame: FrameRequestCallback;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  view = new EditorView({ state: EditorState.create({ doc: '前言。\n\n目标 [[研究]]。' }) });
  setView(view);
  useEditorStore.setState({ activePath: 'a.md', tabs: [{ path: 'a.md', name: 'a.md' }], dirty: {} });
  useVaultStore.setState({ vault: { root: '/fixture', name: 'fixture', repoRoot: null } });
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1; });
});
afterEach(() => { view.destroy(); setView(null); vi.restoreAllMocks(); });

it('异步定位只在原文档与原选区仍有效时应用，正文不变', async () => {
  const parsed = deferred<{ from: number; to: number }>();
  const pending = openFileAndLocate('a.md', () => parsed.promise);
  frame(0);
  parsed.resolve({ from: 8, to: 14 });
  expect(await pending).toBe(true);
  expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('[[研究]]');
  expect(view.state.doc.toString()).toBe('前言。\n\n目标 [[研究]]。');
});

it.each(['edit', 'selection'] as const)('异步定位期间的 %s 是更新的意图，旧位置不覆盖它', async (kind) => {
  const parsed = deferred<{ from: number; to: number }>();
  const pending = openFileAndLocate('a.md', () => parsed.promise); frame(0);
  if (kind === 'edit') view.dispatch({ changes: { from: 0, insert: '新内容 ' } });
  else view.dispatch({ selection: { anchor: 2 } });
  const before = view.state.selection.main;
  parsed.resolve({ from: 8, to: 14 });
  expect(await pending).toBe(false);
  expect(view.state.selection.main).toEqual(before);
});

it('新导航取消旧Worker的信号并结束定位，不留悬空Promise', async () => {
  let signal: AbortSignal | undefined;
  const pending = openFileAndLocate('a.md', (_state, nextSignal) => {
    signal = nextSignal;
    return new Promise((_resolve, reject) => nextSignal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }));
  });
  frame(0); beginDocumentNavigation();
  expect(signal?.aborted).toBe(true);
  expect(await pending).toBe(false);
});

it('同步定位异常明确拒绝，不因rAF回调抛错而永远等待', async () => {
  const pending = openFileAndLocate('a.md', () => { throw new Error('fixture parse failed'); });
  const error = expect(pending).rejects.toThrow('fixture parse failed'); frame(0); await error;
});
