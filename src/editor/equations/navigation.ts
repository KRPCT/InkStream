import type { EditorView } from '@codemirror/view';
import { showToast } from '../../stores/useToastStore';
import { revealRange } from '../viewHandle';
import { clearFormulaEdit, formulaEditState } from '../livepreview/formulaEditState';
import { equationCatalog } from './catalog';
import { equationReferenceLabel } from './markers';

/** 仅认领已启用编号文档中的本地 eq anchor；普通 heading/block 继续走现有 wiki 导航。 */
export function navigateEquationTarget(view: EditorView, target: string): boolean {
  if (!target.startsWith('#eq:')) return false;
  const catalog = equationCatalog(view.state);
  if (!catalog.enabled) return false;
  const label = equationReferenceLabel(target);
  const entry = label === null ? undefined : catalog.byLabel.get(label);
  if (!entry) {
    showToast('warning', `未解析的公式引用：${target.slice(1)}。请检查标签是否存在、合法且唯一。`);
    return true;
  }
  if (view.state.field(formulaEditState, false)) view.dispatch({ effects: clearFormulaEdit.of(null) });
  revealRange(view, entry.block.sourceFrom, entry.block.sourceTo);
  return true;
}
