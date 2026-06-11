import { type EditorView, WidgetType } from '@codemirror/view';

/**
 * 任务复选框 widget（行内层 / D-09 / RESEARCH「任务复选框点击改写」/ UI-SPEC 任务复选框行）。
 *
 * 职责：把 GFM 任务标记 `[ ]` / `[x]`（TaskMarker 节点）渲染为可点 `input[type=checkbox]`，
 * 点击经 CM 事务改写文档中间字符（`' '`↔`'x'`），走 history 可撤销（Ctrl+Z）。
 *
 * 改写为「非键盘 dispatch」：复选框点击不是光标移动，故不受 atomicRanges 约束，须**显式**改 TaskMarker
 * 字符位——TaskMarker 形如 `[ ]` / `[x]`（pos 起，长 3），中间状态字符在 `pos+1`，故 dispatch 改
 * `{ from: pos+1, to: pos+2 }`。
 *
 * 安全（T-03-20）：dispatch 范围**固定为 1 字符**（pos+1..pos+2），不可被诱导扩展为任意编辑——
 * 点击只能翻转单个 TaskMarker 状态位。`mousedown` 先 `preventDefault()`：不夺焦点、不移光标
 * （只翻状态，编辑光标位置不受影响）。
 *
 * 性能（RESEARCH 性能纪律）：`eq(other)` 按 `checked + pos`——状态与位置不变则复用旧 DOM（防闪烁）；
 * `ignoreEvent()` 返回 false 让 widget 自己收 mousedown（默认 true 会让 CM 吞事件，复选框就点不动了）。
 * 样式经 class 消费 var(--cm-checkbox-checked) / var(--cm-table-border)，**永不硬编码色值**。
 */
export class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }

  /** 同 checked + pos 视为同一 widget：CM6 复用旧 DOM，不重建（防闪烁）。 */
  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.pos === this.pos;
  }

  /** 返回 false：widget 自己接收 mousedown（否则 CM 默认吞事件，复选框无法点击翻转）。 */
  ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = this.checked;
    input.className = this.checked
      ? 'cm-ink-task-checkbox cm-ink-task-checked'
      : 'cm-ink-task-checkbox';

    // mousedown（非 click）：先 preventDefault 锁住焦点/光标，再 dispatch 翻转 TaskMarker 状态字符。
    input.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({
        changes: {
          from: this.pos + 1,
          to: this.pos + 2,
          insert: this.checked ? ' ' : 'x',
        },
      });
    });

    return input;
  }
}
