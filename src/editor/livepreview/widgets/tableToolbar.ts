import type { EditorView } from '@codemirror/view';
import { applyTableOp, type TableOp } from '../tableCommands';

/**
 * 表格悬浮工具条（TABLE-WYSIWYG-DESIGN §5 入口 a）：鼠标进入表格时浮现的轻量操作条。
 *
 * 纯 DOM（createElement + createElementNS，绝无 innerHTML，承 Security V5 XSS 纪律），挂在 TableWidget
 * 容器内绝对定位。含：插行(上/下)、删行、插列(左/右)、删列、列对齐(左/中/右)。每个按钮 lucide 图标
 * （内联 SVG path，与 lucide-react 同源 path 数据）+ 简体中文 aria-label/title。点击经 applyTableOp 走
 * 同一命令层（与右键菜单同源）。
 *
 * 编辑态来源：工具条按钮操作的目标单元格 = 当前就地编辑态的 cellIndex（由 getCellIndex 注入，读
 * tableEditState）；无编辑态时回落首格（cellIndex 0），保证插行/插列/对齐有据。
 *
 * 事件纪律：按钮用 mousedown preventDefault 防夺走单元格焦点（保持 IME 武装），点击在 click 派发 op。
 */

/** lucide 图标 path 数据（与 lucide-react v1.17 同源，内联以保 widget 纯 DOM）。 */
const ICONS: Record<string, readonly string[]> = {
  arrowUp: ['m5 12 7-7 7 7', 'M12 19V5'],
  arrowDown: ['M12 5v14', 'm19 12-7 7-7-7'],
  arrowLeft: ['m12 19-7-7 7-7', 'M19 12H5'],
  arrowRight: ['M5 12h14', 'm12 5 7 7-7 7'],
  trash: ['M10 11v6', 'M14 11v6', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M3 6h18', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  alignLeft: ['M21 5H3', 'M15 12H3', 'M17 19H3'],
  alignCenter: ['M21 5H3', 'M17 12H7', 'M19 19H5'],
  alignRight: ['M21 5H3', 'M21 12H9', 'M21 19H7'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 据 path 数据构建一个 16px lucide 风格 SVG 图标（createElementNS，无 innerHTML）。 */
function buildIcon(paths: readonly string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

/** 工具条按钮规格：图标 + 中文标签 + 对应 op。 */
interface ButtonSpec {
  readonly icon: readonly string[];
  readonly label: string;
  readonly op: TableOp;
}

/** 工具条按钮列表（§5 操作集，含分组分隔）。 */
const BUTTONS: readonly (ButtonSpec | 'sep')[] = [
  { icon: ICONS.arrowUp, label: '在上方插入行', op: { kind: 'insertRowAbove' } },
  { icon: ICONS.arrowDown, label: '在下方插入行', op: { kind: 'insertRowBelow' } },
  { icon: ICONS.trash, label: '删除当前行', op: { kind: 'deleteRow' } },
  'sep',
  { icon: ICONS.arrowLeft, label: '在左侧插入列', op: { kind: 'insertColLeft' } },
  { icon: ICONS.arrowRight, label: '在右侧插入列', op: { kind: 'insertColRight' } },
  { icon: ICONS.trash, label: '删除当前列', op: { kind: 'deleteCol' } },
  'sep',
  { icon: ICONS.alignLeft, label: '左对齐', op: { kind: 'align', align: 'left' } },
  { icon: ICONS.alignCenter, label: '居中对齐', op: { kind: 'align', align: 'center' } },
  { icon: ICONS.alignRight, label: '右对齐', op: { kind: 'align', align: 'right' } },
];

/** 删行/删列按钮（其 op.kind）——删列只剩一列时禁用提示由命令层静默拦截，这里不预禁。 */

/**
 * 构建并挂载工具条到 widget 容器（绝对定位于表格右上角，hover 才显）。
 *
 * @param container widget 根容器（position: relative）。
 * @param tableFrom 表格身份键（dispatch 时定位）。
 * @param view EditorView。
 * @param getCellIndex 取当前目标 cellIndex（读 tableEditState，无则 0）。
 */
export function buildTableToolbar(
  container: HTMLElement,
  tableFrom: number,
  view: EditorView,
  getCellIndex: () => number,
): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'cm-ink-table-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', '表格操作');

  for (const spec of BUTTONS) {
    if (spec === 'sep') {
      const sep = document.createElement('span');
      sep.className = 'cm-ink-table-toolbar-sep';
      sep.setAttribute('aria-hidden', 'true');
      bar.appendChild(sep);
      continue;
    }
    bar.appendChild(buildButton(spec, tableFrom, view, getCellIndex));
  }
  container.appendChild(bar);
  return bar;
}

/** 构建单个工具条按钮（mousedown 防夺焦、click 派发 op）。 */
function buildButton(
  spec: ButtonSpec,
  tableFrom: number,
  view: EditorView,
  getCellIndex: () => number,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cm-ink-table-toolbar-btn';
  btn.setAttribute('aria-label', spec.label);
  btn.title = spec.label;
  btn.appendChild(buildIcon(spec.icon));
  // mousedown 不夺走单元格焦点（保 IME 武装、保编辑态读取）；操作落在 click。
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyTableOp(view, tableFrom, getCellIndex(), spec.op);
  });
  return btn;
}
