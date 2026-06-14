import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import AcademicToolbar from './AcademicToolbar';
import EditorArea from './EditorArea';

/**
 * 中央区（editor-area 面板内容）：EditorArea **永不卸载**（display:none 切换保 CM 实例 / IME 锚定 / 光标，
 * 承五插槽零卸载铁律）。Academic 模式在编辑器上方挂学术工具栏（ACAD-02）。
 * GitGraphView 由 WorkbenchLayout 作全宽覆盖层渲染（盖住三栏），故此处不含它。
 */
export default function CentralArea() {
  const view = useWorkbenchStore((s) => s.centralView);
  const mode = useWorkbenchStore((s) => s.mode);
  return (
    <div className="flex h-full flex-col" style={{ display: view === 'editor' ? undefined : 'none' }}>
      {mode === 'academic' ? <AcademicToolbar /> : null}
      <div className="min-h-0 flex-1">
        <EditorArea />
      </div>
    </div>
  );
}
