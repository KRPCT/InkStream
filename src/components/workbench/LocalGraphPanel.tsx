import { Waypoints } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openFileByPath } from '../../editor/fileOpenFlow';
import { buildVaultGraph, localGraph } from '../../graph/buildGraph';
import GraphCanvas from '../../graph/GraphCanvas';
import type { VaultGraph } from '../../graph/types';
import { queryGraphData } from '../../ipc/indexService';
import { useEditorStore } from '../../stores/useEditorStore';
import EmptyState from '../common/EmptyState';

/**
 * 局部图谱面板（Phase 10 / LINK-06）：RightPanel Local Graph tab，显示活动文件 1 跳邻域。
 * 复用全库 queryGraphData + buildVaultGraph，再 localGraph 抽取邻域。点击节点单内核打开。
 * 活动文件变化时重建（v1 简化；大库可后续缓存全图）。无活动 / 无链接 → 逐 tab 空态文案。
 */
export default function LocalGraphPanel() {
  const activePath = useEditorStore((s) => s.activePath);
  const [graph, setGraph] = useState<VaultGraph | null>(null);

  useEffect(() => {
    if (!activePath) {
      setGraph(null);
      return;
    }
    let alive = true;
    void queryGraphData().then((data) => {
      if (!alive) return;
      const full = buildVaultGraph(data.files, data.links);
      setGraph(localGraph(full, activePath, 1));
    });
    return () => {
      alive = false;
    };
  }, [activePath]);

  if (!activePath || !graph || graph.nodes.length <= 1) {
    return (
      <EmptyState
        icon={Waypoints}
        heading="暂无局部图谱"
        body={activePath ? '当前文件建立链接后，这里会显示它的关系网络。' : '打开一个文件后，这里会显示它的关系网络。'}
      />
    );
  }
  return (
    <div className="h-full">
      <GraphCanvas graph={graph} activeId={activePath} onOpen={(id) => void openFileByPath(id)} />
    </div>
  );
}
