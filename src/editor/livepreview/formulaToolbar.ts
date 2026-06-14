import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { setFormulaEdit } from './formulaEditState';

/**
 * 就地渲染公式 widget 的悬浮工具栏（块编辑增强 W3，仿 tableToolbar）：编辑 / 复制源码 / 删除。
 * 三 widget（Math/Latex/Typst）的 toDOM 把渲染内容包进 .cm-ink-formula-wrap（相对定位）并调本函数挂工具条；
 * hover/focus-within 才显（CSS 在 blockField.formulaEditTheme）。纯 DOM createElementNS（守 XSS）。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// lucide path（1.17 同源，内联保纯 DOM）：pencil(编辑) / copy(复制) / trash(删除)。
const ICONS = {
  pencil: [
    'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    'm15 5 4 4',
  ],
  copy: [
    'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
    'M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z',
  ],
  trash: ['M10 11v6', 'M14 11v6', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
} as const;

function buildIcon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    width: '15',
    height: '15',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.75',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) {
    svg.setAttribute(k, v);
  }
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

function makeBtn(label: string, icon: readonly string[], onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cm-ink-formula-toolbar-btn';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.appendChild(buildIcon(icon));
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // 防夺焦
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/** 给公式 widget 容器挂悬浮工具条。 */
export function buildFormulaToolbar(
  wrap: HTMLElement,
  view: EditorView,
  blockFrom: number,
  blockTo: number,
  source: string,
): void {
  const bar = document.createElement('div');
  bar.className = 'cm-ink-formula-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '公式块操作');
  bar.append(
    makeBtn('编辑（双栏预览）', ICONS.pencil, () => {
      view.dispatch({ effects: setFormulaEdit.of({ blockFrom }) });
    }),
    makeBtn('复制源码', ICONS.copy, () => {
      void navigator.clipboard?.writeText(source);
    }),
    makeBtn('删除公式块', ICONS.trash, () => {
      view.dispatch({
        changes: { from: blockFrom, to: blockTo, insert: '' },
        selection: EditorSelection.cursor(blockFrom),
      });
      view.focus();
    }),
  );
  wrap.appendChild(bar);
}
