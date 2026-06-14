import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import EditorArea from './EditorArea';

/**
 * 中央区（editor-area 面板内容）：仅 EditorArea，**永不卸载**（display:none 切换保 CM 实例 / IME 锚定 / 光标，
 * 承五插槽零卸载铁律）。GitGraphView 改由 WorkbenchLayout 作**全宽覆盖层**渲染——盖住三栏占满宽度
 * （不再受 editor-area 面板宽度限制），故此处只留编辑器。
 */
export default function CentralArea() {
  const view = useWorkbenchStore((s) => s.centralView);
  return (
    <div className="h-full" style={{ display: view === 'editor' ? undefined : 'none' }}>
      <EditorArea />
    </div>
  );
}
