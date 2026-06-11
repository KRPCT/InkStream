import { useEffect, type RefObject } from 'react';
import { useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEditorStore } from '../stores/useEditorStore';
import { scheduleAutosave } from '../stores/autosave';
import { baseExtensions } from './extensions';
import { setView } from './viewHandle';

/**
 * 全 App 单内核 hook（RESEARCH Pattern 1，EDIT-01）。
 *
 * - effect 内 `new EditorView`，cleanup 内 `view.destroy()` + viewRef 复位——React 19
 *   StrictMode 开发态 effect 双跑必须严格配对，否则泄漏两个 view（Pitfall 1）。
 * - view 实例存 ref，绝不进 React state（重渲染不重建，单内核纪律）。
 * - updateListener 单向镜像：docChanged → markDirty(activePath)；selectionSet/docChanged
 *   → setCursor(head)。store 永不回写 CM（Pattern 3 真相源纪律）。
 *
 * 返回 viewRef 供调用方（EditorArea）在打开文件时 openFile(view, ...)。
 */
export function useCodeMirror(parentRef: RefObject<HTMLElement | null>): RefObject<EditorView | null> {
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;

    const syncListener = EditorView.updateListener.of((u) => {
      const activePath = useEditorStore.getState().activePath;
      if (u.docChanged && activePath) {
        useEditorStore.getState().markDirty(activePath);
        // 编辑触发防抖自动落盘（D-02 原子写，500ms 防抖合并）
        scheduleAutosave(activePath);
      }
      if (u.selectionSet || u.docChanged) {
        useEditorStore.getState().setCursor(u.state.selection.main.head);
      }
    });

    const view = new EditorView({
      state: EditorState.create({ doc: '', extensions: [...baseExtensions(), syncListener] }),
      parent,
    });
    viewRef.current = view;
    setView(view);

    if (import.meta.env.MODE === 'test') {
      (globalThis as unknown as { __ink_test_view?: EditorView }).__ink_test_view = view;
    }

    return () => {
      view.destroy();
      viewRef.current = null;
      setView(null);
    };
  }, [parentRef]);

  return viewRef;
}
