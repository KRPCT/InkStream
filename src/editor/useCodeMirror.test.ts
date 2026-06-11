import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode, createElement, useRef } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useCodeMirror } from './useCodeMirror';
import { useEditorStore } from '../stores/useEditorStore';

// React 19 act() 环境标记
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** 测试宿主组件：挂载 useCodeMirror 到一个 div。 */
function Host(): ReturnType<typeof createElement> {
  const parentRef = useRef<HTMLDivElement | null>(null);
  useCodeMirror(parentRef);
  return createElement('div', { ref: parentRef, 'data-testid': 'cm-host' });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  useEditorStore.setState({ tabs: [], activePath: 'a.md', dirty: {}, cursor: 0 });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useCodeMirror', () => {
  it('mounts exactly one EditorView under StrictMode double-invoke (Pitfall 1)', () => {
    act(() => {
      root.render(createElement(StrictMode, null, createElement(Host)));
    });
    // StrictMode 开发态 effect 双跑：cleanup 内 destroy 必须严格配对，DOM 只剩一个 .cm-editor
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(1);
  });

  it('docChanged mirrors dirty flag into useEditorStore (单向镜像)', () => {
    act(() => {
      root.render(createElement(StrictMode, null, createElement(Host)));
    });
    const view = (
      globalThis as unknown as { __ink_test_view?: { dispatch: (tr: unknown) => void } }
    ).__ink_test_view;
    expect(view).toBeDefined();
    act(() => {
      view!.dispatch({ changes: { from: 0, insert: 'x' } });
    });
    expect(useEditorStore.getState().dirty['a.md']).toBe(true);
  });
});
