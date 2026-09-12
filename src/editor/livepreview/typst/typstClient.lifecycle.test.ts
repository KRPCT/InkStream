import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroyTestView, makeTestView } from '../../../test/composition';
import { installControlledTypstWorker, latestTypstWorker } from '../../../test/typstWorker';
import {
  __setTypstForTest,
  disposeTypst,
  ensureTypst,
  requestCompile,
  typstReady,
} from './typstClient';

type Outcome = { status: 'pending' } | { status: 'resolved'; value: unknown } | { status: 'rejected'; error: unknown };

function observe(value: unknown): () => Outcome {
  let outcome: Outcome = { status: 'pending' };
  void Promise.resolve(value).then(
    (result) => { outcome = { status: 'resolved', value: result }; },
    (error: unknown) => { outcome = { status: 'rejected', error }; },
  );
  return () => outcome;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 40"><path d="M1 1L20 20"/></svg>';
let view: EditorView | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  disposeTypst();
  __setTypstForTest(false);
  installControlledTypstWorker();
  view = makeTestView('正文\n\n```typst\n$ x + y $\n```');
});

afterEach(async () => {
  disposeTypst();
  await Promise.resolve();
  destroyTestView(view);
  view = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Typst 编译请求生命周期（真实 client，Worker 传输桩）', () => {
  it('冷加载请求保持 pending，就绪后编译并返回 SVG', async () => {
    ensureTypst(view!);
    const outcome = observe(requestCompile(view!, 'block', '$ x + y $'));
    await vi.advanceTimersByTimeAsync(250);
    expect(outcome()).toEqual({ status: 'pending' });
    const worker = latestTypstWorker();
    expect(worker.compileRequests()).toHaveLength(0);
    worker.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(250);
    expect(worker.compileRequests()).toHaveLength(1);
    worker.emit({ type: 'result', id: worker.compileRequests()[0].id, ok: true, svg: SVG });
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome()).toEqual({ status: 'resolved', value: SVG });
  });

  it('dispose 结束未完成请求，并忽略已终止 Worker 的迟到 ready', async () => {
    ensureTypst(view!);
    const worker = latestTypstWorker();
    worker.emit({ type: 'ready' });
    const outcome = observe(requestCompile(view!, 'block', '$ x + y $'));
    await vi.advanceTimersByTimeAsync(250);
    disposeTypst();
    worker.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome()).toMatchObject({ status: 'rejected', error: { name: 'AbortError' } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(typstReady()).toBe(false);
  });

  it('更改文档后，旧请求结果不触发当前文档的预览刷新', async () => {
    ensureTypst(view!);
    const worker = latestTypstWorker();
    worker.emit({ type: 'ready' });
    observe(requestCompile(view!, 'block', '$ x + y $'));
    await vi.advanceTimersByTimeAsync(250);
    view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: '新文档' } });
    const dispatch = vi.spyOn(view!, 'dispatch');
    worker.emit({ type: 'result', id: worker.compileRequests()[0].id, ok: true, svg: SVG });
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatch).not.toHaveBeenCalled();
    expect(view!.state.doc.toString()).toBe('新文档');
  });

  it('Worker 错误结束请求，下一次请求可创建新 Worker 恢复', async () => {
    ensureTypst(view!);
    const worker = latestTypstWorker();
    worker.emit({ type: 'ready' });
    const failed = observe(requestCompile(view!, 'block', '$ x + y $'));
    await vi.advanceTimersByTimeAsync(250);
    worker.fail('worker transport failed');
    await vi.advanceTimersByTimeAsync(0);
    expect(failed()).toMatchObject({ status: 'rejected', error: { message: expect.stringContaining('worker transport failed') } });
    expect(typstReady()).toBe(false);
    ensureTypst(view!);
    expect(latestTypstWorker()).not.toBe(worker);
    const recovered = observe(requestCompile(view!, 'block', '$ x + y $'));
    const next = latestTypstWorker();
    next.emit({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(250);
    next.emit({ type: 'result', id: next.compileRequests()[0].id, ok: true, svg: SVG });
    await vi.advanceTimersByTimeAsync(0);
    expect(recovered()).toEqual({ status: 'resolved', value: SVG });
  });

  it('无返回的编译在有界期限内失败并释放 Worker', async () => {
    ensureTypst(view!);
    const worker = latestTypstWorker();
    worker.emit({ type: 'ready' });
    const outcome = observe(requestCompile(view!, 'block', '$ x + y $'));
    await vi.advanceTimersByTimeAsync(60_001);
    expect(outcome()).toMatchObject({ status: 'rejected', error: { name: 'TimeoutError' } });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
