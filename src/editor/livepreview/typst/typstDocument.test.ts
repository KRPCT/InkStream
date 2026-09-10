import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTypstStore } from '../../../stores/useTypstStore';
import { makeTestView, destroyTestView } from '../../../test/composition';
import { installControlledTypstWorker, latestTypstWorker } from '../../../test/typstWorker';
import { documentBudgetField, setDocumentPreference } from '../../documentBudget';
import { extensionsForLanguage } from '../../languages';
import { __setTypstForTest, compileTypst, disposeTypst } from './typstClient';
import { typstCompilationExtension } from './typstDocument';

let view: EditorView | null = null;
const doc = (source: string) => `正文\n\n\`\`\`typst\n${source}\n\`\`\``;
const svg = (id: string) => `<svg xmlns="http://www.w3.org/2000/svg"><title>${id}</title><path d="M0 0L1 1"/></svg>`;
const extensions = () => [extensionsForLanguage('markdown'), documentBudgetField, typstCompilationExtension];

beforeEach(() => {
  vi.useFakeTimers();
  disposeTypst();
  __setTypstForTest(false);
  installControlledTypstWorker();
});
afterEach(async () => {
  destroyTestView(view);
  view = null;
  disposeTypst();
  await Promise.resolve();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Typst 当前文档编译镜像', () => {
  it('快改两版后只发布最新 revision 的 SVG，迟到旧结果不回写', async () => {
    view = makeTestView(doc('$ a $'), extensions());
    const first = latestTypstWorker();
    first.emit({ type: 'ready' });
    const oldRequest = first.compileRequests()[0];
    const session = useTypstStore.getState().session;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc('$ b $') } });
    await vi.advanceTimersByTimeAsync(200);
    const second = latestTypstWorker();
    second.emit({ type: 'ready' });
    first.emit({ type: 'result', id: oldRequest.id, ok: true, svg: svg('stale') });
    await vi.advanceTimersByTimeAsync(0);
    expect(useTypstStore.getState()).toMatchObject({ session, revision: 1, phase: 'compiling' });
    expect(useTypstStore.getState().blocks[0]).toMatchObject({ source: '$ b $', svg: null });
    const latest = second.compileRequests()[0];
    second.emit({ type: 'result', id: latest.id, ok: true, svg: svg('latest') });
    await vi.advanceTimersByTimeAsync(0);
    expect(useTypstStore.getState()).toMatchObject({ session, revision: 1, phase: 'ready' });
    expect(useTypstStore.getState().blocks[0].svg).toBe(svg('latest'));
  });

  it('setState 切文档会结束旧会话，旧结果不出现在没有 Typst 的新文档', async () => {
    view = makeTestView(doc('$ a $'), extensions());
    const worker = latestTypstWorker();
    worker.emit({ type: 'ready' });
    const request = worker.compileRequests()[0];
    const previousSession = useTypstStore.getState().session;
    view.setState(EditorState.create({ doc: '没有公式的新文档', extensions: extensions() }));
    worker.emit({ type: 'result', id: request.id, ok: true, svg: svg('old-document') });
    await vi.advanceTimersByTimeAsync(0);
    expect(useTypstStore.getState().session).not.toBe(previousSession);
    expect(useTypstStore.getState()).toMatchObject({ phase: 'idle', blocks: [] });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('基础编辑取消编译，显式恢复完整排版后重新编译同一文档', async () => {
    view = makeTestView(doc('$ a $'), extensions());
    const previous = latestTypstWorker();
    previous.emit({ type: 'ready' });
    view.dispatch({ effects: setDocumentPreference.of('basic') });
    expect(useTypstStore.getState()).toMatchObject({ phase: 'paused', blocks: [] });
    expect(previous.terminate).toHaveBeenCalledOnce();
    view.dispatch({ effects: setDocumentPreference.of('full') });
    await vi.advanceTimersByTimeAsync(0);
    const next = latestTypstWorker();
    expect(next).not.toBe(previous);
    next.emit({ type: 'ready' });
    const request = next.compileRequests()[0];
    next.emit({ type: 'result', id: request.id, ok: true, svg: svg('resumed') });
    await vi.advanceTimersByTimeAsync(0);
    expect(useTypstStore.getState()).toMatchObject({ phase: 'ready' });
    expect(useTypstStore.getState().blocks[0].svg).toBe(svg('resumed'));
  });

  it('相同源码的一个订阅取消，不中断另一个仍需要的编译', async () => {
    const first = new AbortController();
    const second = new AbortController();
    const cancelled = compileTypst('$ a $', { signal: first.signal }).catch((error: unknown) => error);
    const retained = compileTypst('$ a $', { signal: second.signal });
    const worker = latestTypstWorker();
    worker.emit({ type: 'ready' });
    expect(worker.compileRequests()).toHaveLength(1);
    first.abort();
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit({ type: 'result', id: worker.compileRequests()[0].id, ok: true, svg: svg('shared') });
    await expect(retained).resolves.toBe(svg('shared'));
  });
});
