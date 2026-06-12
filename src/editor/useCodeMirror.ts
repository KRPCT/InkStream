import { useEffect, type RefObject } from 'react';
import { useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { baseExtensions } from './extensions';
import { RELAY_ENABLED } from './relay';
import { installRelayController } from './relay/relayController';
import { setView } from './viewHandle';

/**
 * 全 App 单内核 hook（RESEARCH Pattern 1，EDIT-01）。
 *
 * - effect 内 `new EditorView`，cleanup 内 `view.destroy()` + viewRef 复位——React 19
 *   StrictMode 开发态 effect 双跑必须严格配对，否则泄漏两个 view（Pitfall 1）。
 * - view 实例存 ref，绝不进 React state（重渲染不重建，单内核纪律）。
 * - store 镜像 listener 已下沉 baseExtensions（mirrorListener.ts，P0 修复）：updateListener
 *   是 state 级 facet，只拼初始 state 会在第一次 openFile 换装后失联（铁律 0）。
 * - 输入中继（PROD-RELAY-DESIGN）：状态级扩展随 baseExtensions 进每个 state；视图级接线
 *   （隐藏 textarea / focus net / scroll 跟随）经 installRelayController 挂 parent，
 *   与 view 生命周期严格配对（teardown 先于 destroy）。flag 关时不装，回退旧路径。
 *
 * 返回 viewRef 供调用方（EditorArea）在打开文件时 openFile(view, ...)。
 */
export function useCodeMirror(parentRef: RefObject<HTMLElement | null>): RefObject<EditorView | null> {
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;

    const view = new EditorView({
      state: EditorState.create({ doc: '', extensions: baseExtensions() }),
      parent,
    });
    viewRef.current = view;
    setView(view);
    const teardownRelay = RELAY_ENABLED ? installRelayController(view, parent) : null;

    if (import.meta.env.MODE === 'test') {
      (globalThis as unknown as { __ink_test_view?: EditorView }).__ink_test_view = view;
    }

    return () => {
      teardownRelay?.();
      view.destroy();
      viewRef.current = null;
      setView(null);
      // IN-08：清测试态全局桩——否则 cleanup 后 __ink_test_view 仍指向已 destroy 的 view，跨用例泄漏。
      if (import.meta.env.MODE === 'test') {
        delete (globalThis as unknown as { __ink_test_view?: EditorView }).__ink_test_view;
      }
    };
  }, [parentRef]);

  return viewRef;
}
