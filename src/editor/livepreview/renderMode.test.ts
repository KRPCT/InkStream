import { EditorSelection } from '@codemirror/state';
import { undo } from '@codemirror/commands';
import { history } from '@codemirror/commands';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';
import { setView } from '../viewHandle';
import { useEditorStore } from '../../stores/useEditorStore';
import {
  getRenderMode,
  isMarkdownDoc,
  renderModeCompartment,
  setRenderMode,
  toggleRenderMode,
} from './renderMode';
import { livePreviewExtensions } from './livePreview';

/**
 * renderMode 热切回归门（D-03 保会话态 + D-01 非 md no-op + UI 镜像）。
 *
 * setRenderMode 必须经 renderModeCompartment.reconfigure 切换，绝不 EditorState.create——
 * 故断言切换前后 doc / 选区 / undo 深度全保留（热切非重建，T-03-09）。
 */

let view: EditorView | null = null;

function mdView(doc = '# H1\n\n正文'): EditorView {
  return makeTestView(doc, [
    history(),
    extensionsForLanguage('markdown'),
    renderModeCompartment.of(livePreviewExtensions()),
  ]);
}

beforeEach(() => {
  useEditorStore.setState({ activeRenderMode: 'live' });
});

afterEach(() => {
  setView(null);
  destroyTestView(view);
  view = null;
});

describe('setRenderMode 热切（D-03 保会话态）', () => {
  it('source ↔ live 往返：doc / 选区 / undo 深度不变（reconfigure 非重建）', () => {
    view = mdView();
    // 制造一条可撤销编辑 + 一处非平凡选区，作为会话态见证。
    view.dispatch({ changes: { from: view.state.doc.length, insert: ' 追加' } });
    view.dispatch({ selection: EditorSelection.range(2, 5) });
    const docBefore = view.state.doc.toString();
    const selBefore = view.state.selection.main;

    setRenderMode(view, 'source');
    expect(getRenderMode(view)).toBe('source');
    setRenderMode(view, 'live');
    expect(getRenderMode(view)).toBe('live');

    // 热切零迁移：doc 与选区原样保留。
    expect(view.state.doc.toString()).toBe(docBefore);
    expect(view.state.selection.main.from).toBe(selBefore.from);
    expect(view.state.selection.main.to).toBe(selBefore.to);

    // undo 历史仍可撤销那条编辑（reconfigure 不清 history）。
    undo(view);
    expect(view.state.doc.toString()).not.toBe(docBefore);
    expect(view.state.doc.toString()).toBe('# H1\n\n正文');
  });

  it("setRenderMode('source') 卸下 Live Preview 扩展，'live' 装回", () => {
    view = mdView();
    setRenderMode(view, 'source');
    expect(renderModeCompartment.get(view.state)).toEqual([]);
    setRenderMode(view, 'live');
    expect(renderModeCompartment.get(view.state)).not.toEqual([]);
  });
});

describe('toggleRenderMode（取反 + store 镜像 + D-01 no-op）', () => {
  it('markdown 文档：toggle 在 source ↔ live 间取反并写 store 镜像', () => {
    view = mdView();
    setView(view);
    expect(getRenderMode(view)).toBe('live');

    expect(toggleRenderMode()).toBe('source');
    expect(getRenderMode(view)).toBe('source');
    expect(useEditorStore.getState().activeRenderMode).toBe('source');

    expect(toggleRenderMode()).toBe('live');
    expect(getRenderMode(view)).toBe('live');
    expect(useEditorStore.getState().activeRenderMode).toBe('live');
  });

  it('非 markdown 文档：toggleRenderMode 返回 null（D-01 静默 no-op）', () => {
    view = makeTestView("print('hi')", [
      history(),
      extensionsForLanguage('python'),
      renderModeCompartment.of([]),
    ]);
    setView(view);
    // 非 markdown 文档由 editorState 在打开时把镜像置 null；命令据此短路。
    useEditorStore.setState({ activeRenderMode: null });
    expect(toggleRenderMode()).toBeNull();
  });

  it('无 view（编辑器未挂载）：返回 null', () => {
    setView(null);
    expect(toggleRenderMode()).toBeNull();
  });
});

describe('isMarkdownDoc（D-01 markdown/richtext 判定）', () => {
  it('markdown / richtext frontmatter 与 .md 扩展名为真，其余为假', () => {
    expect(isMarkdownDoc('# H1', 'note.md')).toBe(true);
    expect(isMarkdownDoc('---\nlanguage: richtext\n---\n正文', 'note.md')).toBe(true);
    expect(isMarkdownDoc('---\nlanguage: latex\n---\n', 'note.md')).toBe(false);
    expect(isMarkdownDoc("print('hi')", 'main.py')).toBe(false);
  });
});
