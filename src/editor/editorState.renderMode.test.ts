import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { history } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../test/composition';
import { setView } from './viewHandle';
import { useEditorStore } from '../stores/useEditorStore';
import { extensionsForLanguage } from './languages';
import { renderModeCompartment, setRenderMode, getRenderMode } from './livepreview/renderMode';
import { livePreviewExtensions } from './livepreview/livePreview';
import {
  __clearCacheForTest,
  disposeState,
  getRenderModeForPath,
  openFile,
  snapshotBeforeSwitch,
  switchToTab,
} from './editorState';

/**
 * per-file 会话内 renderMode 记忆回归门（D-03）：切走存、切回恢复、关 tab 释放。
 *
 * 权威记忆在模块级 renderModeCache（不可序列化态不进 store，T-03-10）；
 * store.activeRenderMode 仅是当前活动文件的 UI 镜像。
 */

let view: EditorView | null = null;

function ext() {
  return [history(), extensionsForLanguage('markdown'), renderModeCompartment.of(livePreviewExtensions())];
}

beforeEach(() => {
  __clearCacheForTest();
  useEditorStore.setState({ activePath: null, activeRenderMode: 'live', tabs: [] });
  view = makeTestView('# A', ext());
  setView(view);
});

afterEach(() => {
  setView(null);
  destroyTestView(view);
  view = null;
  __clearCacheForTest();
});

describe('per-file renderMode 记忆', () => {
  it('文件 A 设 source、切到 B（默认 live）、切回 A 恢复 source', () => {
    openFile(view!, 'a.md', '# A', ext());
    useEditorStore.getState().setActive('a.md');
    setRenderMode(view!, 'source');
    snapshotBeforeSwitch(view!, 'a.md');
    expect(getRenderModeForPath('a.md')).toBe('source');

    // 打开 B：未记忆过 → 默认 live（D-02）。
    openFile(view!, 'b.md', '# B', ext());
    useEditorStore.getState().setActive('b.md');
    expect(getRenderMode(view!)).toBe('live');
    expect(useEditorStore.getState().activeRenderMode).toBe('live');

    // 切回 A：恢复其 source 记忆。
    snapshotBeforeSwitch(view!, 'b.md');
    switchToTab('a.md');
    expect(getRenderMode(view!)).toBe('source');
    expect(useEditorStore.getState().activeRenderMode).toBe('source');
  });

  it('disposeState(A) 后 renderModeCache 无 A（关 tab 释放）', () => {
    openFile(view!, 'a.md', '# A', ext());
    useEditorStore.getState().setActive('a.md');
    setRenderMode(view!, 'source');
    snapshotBeforeSwitch(view!, 'a.md');
    expect(getRenderModeForPath('a.md')).toBe('source');

    disposeState('a.md');
    expect(getRenderModeForPath('a.md')).toBeNull();
  });

  it('非 markdown 文件：activeRenderMode 镜像置 null（指示器隐藏，D-01）', () => {
    openFile(view!, 'main.py', "print('hi')", [history(), extensionsForLanguage('python'), renderModeCompartment.of([])]);
    useEditorStore.getState().setActive('main.py');
    expect(useEditorStore.getState().activeRenderMode).toBeNull();
  });
});
