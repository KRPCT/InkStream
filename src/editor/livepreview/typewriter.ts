import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { useTypewriterStore } from '../../stores/useTypewriterStore';
import { isComposing, refreshLivePreview } from '../composition';
import { getView, scrollContainer } from '../viewHandle';

/**
 * 打字机模式（写作模式升级）：开启时让光标所在行始终滚到视口垂直居中——写作沉浸，视线不下移。
 *
 * 居中作用于真实滚动容器（scrollContainer，#17 根因：本应用滚的是 .cm-scroller 外层 overflow 容器，
 * 非 scrollDOM）。在 view.requestMeasure 的 read/write 两相里算 coordsAtPos↔容器中心差值再调 scrollTop，
 * 避免 update 期读未测量布局造成抖动。开关读 useTypewriterStore（同 focusMode 范式，关闭时零开销）。
 *
 * 文首 / 文末也能居中：开启时给 .cm-content 加 50vh 上下留白（paddingBlock 垂直方向官方允许，见
 * editorBaseTheme 注释；不碰水平盒模型，CM6 命中测试不受扰）。
 *
 * IME 铁律：组合期一律不滚动——滚动 DOM 会撕正在合成的节点吞字（同 focusMode 短路契约）。
 */

function center(view: EditorView): void {
  view.requestMeasure({
    key: 'ink-typewriter',
    read: (v) => {
      const coords = v.coordsAtPos(v.state.selection.main.head);
      if (!coords) return null;
      const container = scrollContainer(v);
      const rect = container.getBoundingClientRect();
      const cursorCenter = (coords.top + coords.bottom) / 2;
      const containerCenter = rect.top + rect.height / 2;
      return { container, delta: Math.round(cursorCenter - containerCenter) };
    },
    write: (m) => {
      if (m && m.delta !== 0) m.container.scrollTop += m.delta;
    },
  });
}

class TypewriterPluginValue {
  constructor(view: EditorView) {
    this.sync(view);
    if (useTypewriterStore.getState().active) center(view);
  }

  update(u: ViewUpdate): void {
    this.sync(u.view);
    if (!useTypewriterStore.getState().active) return;
    const refreshed = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLivePreview)));
    // IME 铁律：组合期不滚动（撕合成节点吞字）。只在光标移动 / 文本变更 / 刷新时居中，
    // 不挂 viewport/geometry 变化——避免居中自身改 scrollTop 触发的回环。
    if (!refreshed && isComposing(u.view)) return;
    if (u.docChanged || u.selectionSet || refreshed) center(u.view);
  }

  /** 同步开关态到 .cm-editor 的 class，驱动 50vh 留白 theme。 */
  sync(view: EditorView): void {
    view.dom.classList.toggle('cm-ink-tw', useTypewriterStore.getState().active);
  }
}

export const typewriterPlugin = ViewPlugin.fromClass(TypewriterPluginValue);

export const typewriterTheme = EditorView.baseTheme({
  '&.cm-ink-tw .cm-content': { paddingBlock: '50vh' },
});

/** 打字机模式扩展集（挂入 baseExtensions 顶层，Source/Live 两模式均生效；关闭时零开销）。 */
export const typewriterExtensions = [typewriterPlugin, typewriterTheme];

/** 切换打字机模式：翻转全局开关 + 非组合期派发 refreshLivePreview 让活动视图立即居中。 */
export function toggleTypewriter(): void {
  useTypewriterStore.getState().toggle();
  const v = getView();
  if (v && !isComposing(v)) v.dispatch({ effects: refreshLivePreview.of(null) });
}
