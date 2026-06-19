import type { VaultGraph, WorkerInbound, WorkerOutbound } from './types';

/**
 * 布局 Worker 的主线程包装（Phase 10）。持有 Worker、缓存最近一帧坐标，暴露重排/释放。
 * 节点顺序（order）即 init 顺序，positions[i*2] 对应 order[i] / graph.nodes[i]。
 * Worker 引用经 Vite 范式 `new Worker(new URL('./forceWorker.ts', import.meta.url), {type:'module'})`。
 */
export class GraphLayout {
  private readonly worker: Worker;
  private positions: Float32Array | null = null;
  readonly order: string[];

  constructor(graph: VaultGraph, onTick: () => void, onEnd?: () => void) {
    this.order = graph.nodes.map((n) => n.id);
    this.worker = new Worker(new URL('./forceWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerOutbound>) => {
      const m = ev.data;
      if (m.type === 'tick') {
        this.positions = m.positions;
        onTick();
      } else if (m.type === 'end') {
        onEnd?.();
      }
    };
    this.send({
      type: 'init',
      nodes: graph.nodes.map((n) => ({ id: n.id, degree: n.degree })),
      edges: graph.edges,
    });
  }

  private send(msg: WorkerInbound): void {
    this.worker.postMessage(msg);
  }

  getPositions(): Float32Array | null {
    return this.positions;
  }

  reheat(): void {
    this.send({ type: 'reheat' });
  }

  dispose(): void {
    this.worker.onmessage = null;
    this.worker.terminate();
  }
}
