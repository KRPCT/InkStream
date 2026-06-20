import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import { useFocusModeStore } from '../../stores/useFocusModeStore';
import { isComposing, refreshLivePreview } from '../composition';
import { getView } from '../viewHandle';

/**
 * Focus Mode（CREA-03）：开启时淡化「非光标所在段落」的行。`Decoration.line + opacity`——只给行
 * 包裹元素（.cm-line）加 class、不裂文本节点、不 replace/widget → 光标/选区/IME 全程不受扰（铁律）。
 * update 逐字复制 inlinePlugin 冻结契约（组合期短路 map-not-rebuild）；选区移动即重算亮区（光标段落跟随）。
 * 全局开关 useFocusModeStore；F11（编辑器 keymap，preventDefault 避 WebView2 全屏）/ toggleFocusMode 切换。
 */

const dimLine = Decoration.line({ class: 'cm-ink-focus-dim' });

/** 光标所在段落行号区间 [first,last]（空行分隔；光标在空行上则单行）。 */
function cursorParagraph(view: EditorView): { first: number; last: number } {
  const { doc, selection } = view.state;
  const cur = doc.lineAt(selection.main.head).number;
  let first = cur;
  let last = cur;
  while (first > 1 && doc.line(first - 1).text.trim() !== '') first -= 1;
  while (last < doc.lines && doc.line(last + 1).text.trim() !== '') last += 1;
  // 全文无空行分段（整篇被当成一段）时，淡化范围为空、效果不可见——退化为只高亮光标行。
  // 这覆盖「连续大段不空行」「软换行散文」等写法，让专注模式始终有可见的淡化。
  if (first === 1 && last === doc.lines && doc.lines > 1) return { first: cur, last: cur };
  return { first, last };
}

function build(view: EditorView): DecorationSet {
  if (!useFocusModeStore.getState().active) return Decoration.none;
  const { first, last } = cursorParagraph(view);
  const { doc } = view.state;
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (line.number < first || line.number > last) builder.add(line.from, line.from, dimLine);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

class FocusModePluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = build(view);
  }

  update(u: ViewUpdate): void {
    // 逐字复制 inlinePlugin 契约（铁律）：refreshed 先于 IME 短路；组合期不重建、docChanged 时 map 旧集。
    const refreshed = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLivePreview)));
    if (!refreshed && isComposing(u.view)) {
      if (u.docChanged) this.decorations = this.decorations.map(u.changes);
      return;
    }
    if (u.docChanged || u.viewportChanged || u.selectionSet || refreshed) {
      this.decorations = build(u.view);
    }
  }
}

export const focusModePlugin = ViewPlugin.fromClass(FocusModePluginValue, {
  decorations: (v) => v.decorations,
});

// 用 EditorView.theme（高于 baseTheme 优先级），确保淡化 opacity 不被其它 .cm-line 规则盖过。
export const focusModeTheme = EditorView.theme({
  '.cm-ink-focus-dim': {
    opacity: 'var(--cm-focus-dim-opacity)',
    transition: 'opacity var(--duration-base)',
  },
});

/** Focus Mode 扩展集（挂入 baseExtensions 顶层，Source/Live 两模式均生效）。 */
export const focusModeExtensions = [focusModePlugin, focusModeTheme];

/** 切换 Focus Mode：翻转全局开关 + 非组合期派发 refreshLivePreview 让活动视图立即重建淡化。 */
export function toggleFocusMode(): void {
  useFocusModeStore.getState().toggle();
  const v = getView();
  if (v && !isComposing(v)) v.dispatch({ effects: refreshLivePreview.of(null) });
}
