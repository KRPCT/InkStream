import { afterEach, expect, it } from 'vitest';
import { __resetCompositionForTest, compositionGate } from '../editor/composition';
import { settleEditorComposition } from '../editor/editorState';
import { setView } from '../editor/viewHandle';
import { destroyTestView, dispatchComposition, makeTestView } from '../test/composition';
import type { EditorView } from '@codemirror/view';

let view: EditorView | null = null;
afterEach(() => { if (view) __resetCompositionForTest(view); destroyTestView(view); setView(null); view = null; });
it('后台快照与项目切换并发等待IME时，两份等待都必须完成', async () => {
  view = makeTestView('组合中的完整正文', [compositionGate]); setView(view);
  dispatchComposition(view, { phase: 'compositionstart', data: '中' });
  const finished = [false, false];
  void settleEditorComposition().then(() => { finished[0] = true; });
  void settleEditorComposition().then(() => { finished[1] = true; });
  expect(finished).toEqual([false, false]);
  dispatchComposition(view, { phase: 'compositionend', data: '中' });
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  expect(finished).toEqual([true, true]);
  expect(view.state.doc.toString()).toBe('组合中的完整正文');
});
