import { EditorView } from '@codemirror/view';
import { clearFormulaEdit, formulaEditState } from './formulaEditState';

/**
 * 点双栏块外 → 退出编辑态（块编辑增强 W3，仿 tableGesture）。点块内（textarea / 头部按钮）不接管，交内部 DOM。
 * 不 preventDefault：让主编辑器正常处理这次点击（置光标到点击处）。
 */
export const formulaGesture = EditorView.domEventHandlers({
  mousedown: (event, view) => {
    if (!view.state.field(formulaEditState, false)) return false;
    const target = event.target;
    if (target instanceof Element && target.closest('.cm-ink-formula-edit')) return false;
    view.dispatch({ effects: clearFormulaEdit.of(null) });
    return false;
  },
});
