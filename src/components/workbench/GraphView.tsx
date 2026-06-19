import { Network, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openFileByPath } from '../../editor/fileOpenFlow';
import { buildVaultGraph } from '../../graph/buildGraph';
import GraphCanvas from '../../graph/GraphCanvas';
import type { VaultGraph } from '../../graph/types';
import { queryGraphData } from '../../ipc/indexService';
import { useEditorStore } from '../../stores/useEditorStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';

/**
 * 全库知识 Graph View（Phase 10 / LINK-06）。中央区覆盖层（Ctrl+G / 命令打开，再按回编辑器）。
 * 节点=vault 内 .md 文件、边=wiki 链接；d3-force 布局（Worker）+ Canvas2D 自绘。点击节点打开文件并回
 * 编辑器；活动文件节点高亮。覆盖层不卸载编辑器（保 CM 实例与 IME），打开图谱不抢编辑器焦点。
 */
export default function GraphView() {
  const [graph, setGraph] = useState<VaultGraph | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const activePath = useEditorStore((s) => s.activePath);
  const setCentralView = useWorkbenchStore((s) => s.setCentralView);

  useEffect(() => {
    let alive = true;
    setGraph(null);
    void queryGraphData().then((data) => {
      if (alive) setGraph(buildVaultGraph(data.files, data.links));
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const open = (id: string): void => {
    void openFileByPath(id);
    setCentralView('editor');
  };

  const btn =
    'rounded p-1 text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)] hover:text-[var(--text-normal)]';

  return (
    <div className="flex h-full flex-col bg-[var(--background-primary)]">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[var(--background-modifier-border)] px-2">
        <div className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
          <Network size={14} aria-hidden="true" className="shrink-0" />
          <span>
            知识图谱 ·{' '}
            {graph ? `${graph.nodes.length} 节点 / ${graph.edges.length} 链接` : '加载中…'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" title="重新加载" onClick={() => setReloadKey((k) => k + 1)} className={btn}>
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button type="button" title="关闭（回编辑器）" onClick={() => setCentralView('editor')} className={btn}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {graph && graph.nodes.length > 0 ? (
          <GraphCanvas graph={graph} activeId={activePath} onOpen={open} />
        ) : (
          <div className="flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]">
            {graph ? '工作区暂无可索引的文件，或尚未建立链接。' : '正在构建图谱…'}
          </div>
        )}
      </div>
    </div>
  );
}
