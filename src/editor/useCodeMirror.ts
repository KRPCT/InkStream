import { useEffect, type RefObject } from 'react';
import { useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useEditorStore } from '../stores/useEditorStore';
import { scheduleAutosave } from '../stores/autosave';
import { syncRichtext } from './editorState';
import { baseExtensions } from './extensions';
import { reconfigureLanguageFromDoc } from './languages';
import { setView } from './viewHandle';
import { imeTrace } from './livepreview/imeTrace';

/**
 * 全 App 单内核 hook（RESEARCH Pattern 1，EDIT-01）。
 *
 * - effect 内 `new EditorView`，cleanup 内 `view.destroy()` + viewRef 复位——React 19
 *   StrictMode 开发态 effect 双跑必须严格配对，否则泄漏两个 view（Pitfall 1）。
 * - view 实例存 ref，绝不进 React state（重渲染不重建，单内核纪律）。
 * - updateListener 单向镜像：docChanged → markDirty(activePath)；selectionSet/docChanged
 *   → setCursor(head)。store 永不回写 CM（Pattern 3 真相源纪律）。
 * - IME（EDIT-06，Option 1）：docChanged 的重副作用块（markDirty / scheduleAutosave /
 *   reconfigureLanguageFromDoc / syncRichtext）在 `u.view.composing` 期间一律跳过——中文 IME 组合期
 *   每个候选键击都打 docChanged，若每次都跑 React/reconfigure/落盘会拖垮合成并与 CM6 合成保护抢节点；
 *   它们改在组合结束的上屏提交事务（composing 已归 false）上一次性触发。setCursor 廉价（不 dispatch）可留。
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
      // IME 组合期跳过重副作用：组合每个候选键击都打 docChanged，per-keystroke 跑 React/reconfigure/
      // 落盘会拖垮合成并与 CM6 合成保护抢节点；改在组合结束的上屏提交事务（!composing）一次性触发。
      if (u.docChanged && !u.view.composing && activePath) {
        useEditorStore.getState().markDirty(activePath);
        // 编辑触发防抖自动落盘（D-02 原子写，500ms 防抖合并）
        scheduleAutosave(activePath);
        // 手动编辑 frontmatter language 行 → 头部语言变化即热切（D-13 文档单一真相源）。
        // reconfigure 只发 effect（非 docChange），不会自激 updateListener。
        reconfigureLanguageFromDoc(u.view, activePath);
        // richtext 工具条显隐镜像（D-14）：单向自 CM 写入 store，与 dirty/cursor 同纪律。
        syncRichtext(u.view);
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
    // EDIT-06 诊断：view 创建/重建是 IME 节点被整体抽换的最重事件。若组合中途 React 重挂导致重建，
    // 必吞字——记录时间戳供真机比对（StrictMode 开发态双挂亦会出现一对 setup/cleanup，属预期）。
    imeTrace('useCodeMirror.setup', { ts: Date.now() });

    if (import.meta.env.MODE === 'test') {
      (globalThis as unknown as { __ink_test_view?: EditorView }).__ink_test_view = view;
    }

    return () => {
      imeTrace('useCodeMirror.cleanup', { ts: Date.now(), composingAtCleanup: view.composing });
      view.destroy();
      viewRef.current = null;
      setView(null);
    };
  }, [parentRef]);

  return viewRef;
}
