import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import GitGraphView from '../git/GitGraphView';
import EditorArea from './EditorArea';

/**
 * 中央区视图切换（Phase 6 GIT-02）：EditorArea 与 GitGraphView 共处。
 *
 * **EditorArea 永不卸载**（display:none 切换保 CM 实例 / IME 锚定 / 光标，承五插槽零卸载铁律）；
 * GitGraphView 按需挂载（进 git-graph 才 mount 加载 log；退出卸载，下次重进重拉——log 轻、可接受，
 * 且每次进看最新提交）。
 */
export default function CentralArea() {
  const view = useWorkbenchStore((s) => s.centralView);
  return (
    <div className="relative h-full">
      <div className="h-full" style={{ display: view === 'editor' ? undefined : 'none' }}>
        <EditorArea />
      </div>
      {view === 'gitGraph' ? (
        <div className="absolute inset-0">
          <GitGraphView />
        </div>
      ) : null}
    </div>
  );
}
