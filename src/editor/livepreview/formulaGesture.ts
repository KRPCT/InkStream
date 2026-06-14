import { EditorView } from '@codemirror/view';
import { clearFormulaEdit, formulaEditState, setFormulaEdit } from './formulaEditState';

/**
 * 公式块编辑的进/出手势（块编辑增强 W3）：
 *   - 非编辑态：点击就地渲染的公式 widget（.cm-ink-math/.cm-ink-latex/.cm-ink-typst，读其 data-formula-from）
 *     → 进双栏编辑（**点击是主入口**，比悬浮工具栏更易发现；工具栏在公式上方、移过去易脱离 hover 区点不到）。
 *     点工具栏按钮（复制/删除）不进编辑——交按钮自身 click 处理。
 *   - 编辑态：点双栏块外 → 退出（点块内 textarea/头部不接管）。
 * 仿 tableGesture：不程序化抢焦点，textarea 由 formulaEditor 在真实点击链内补焦点。
 */
export const formulaGesture = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    const target = event.target;
    const el = target instanceof Element ? target : null;

    if (view.state.field(formulaEditState, false)) {
      // 编辑中：点双栏内不接管；点块外退出。
      if (el?.closest('.cm-ink-formula-edit')) return false;
      view.dispatch({ effects: clearFormulaEdit.of(null) });
      return false;
    }

    // 非编辑：点工具栏按钮交按钮处理；点公式 widget 本体 → 进双栏编辑。
    if (el?.closest('.cm-ink-formula-toolbar')) return false;
    const wrap = el?.closest('.cm-ink-math, .cm-ink-latex, .cm-ink-typst');
    const from = wrap instanceof HTMLElement ? wrap.dataset.formulaFrom : undefined;
    if (from !== undefined) {
      view.dispatch({ effects: setFormulaEdit.of({ blockFrom: Number(from) }) });
      return true; // 消费此次点击（不再走主编辑器置光标）
    }
    return false;
  },
});
