import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GraphEdgeData, WorkerInbound, WorkerOutbound } from './types';

/**
 * 布局 Worker（Phase 10 / LINK-06）：d3-force 力导模拟跑在 Worker 线程，每步把坐标经
 * Float32Array transfer 回传主线程（零拷贝），主线程只负责 Canvas2D 绘制。手动驱动 tick（不依赖 d3
 * 内部 timer，Worker 内无 requestAnimationFrame），alpha 衰减到阈值即自停省 CPU。范式对照 typstWorker。
 */

interface SimNode extends SimulationNodeDatum {
  id: string;
  degree: number;
}
type SimLink = SimulationLinkDatum<SimNode>;

let sim: Simulation<SimNode, SimLink> | null = null;
let nodes: SimNode[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const post = (msg: WorkerOutbound, transfer: Transferable[] = []): void =>
  (self as unknown as Worker).postMessage(msg, transfer);

function radius(degree: number): number {
  return 3 + Math.min(8, Math.sqrt(degree) * 1.6);
}

function emit(): void {
  const buf = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    buf[i * 2] = nodes[i].x ?? 0;
    buf[i * 2 + 1] = nodes[i].y ?? 0;
  }
  post({ type: 'tick', positions: buf }, [buf.buffer]);
}

function loop(): void {
  if (!sim) return;
  sim.tick();
  emit();
  if (sim.alpha() < sim.alphaMin()) {
    post({ type: 'end' });
    timer = null;
    return;
  }
  timer = setTimeout(loop, 16);
}

function start(inNodes: Array<{ id: string; degree: number }>, edges: GraphEdgeData[]): void {
  const n = Math.max(1, inNodes.length);
  nodes = inNodes.map((d, i) => {
    const a = (i / n) * Math.PI * 2;
    const r = Math.sqrt(n) * 8;
    return { id: d.id, degree: d.degree, x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  const links: SimLink[] = edges.map((e) => ({ source: e.source, target: e.target }));
  sim = forceSimulation<SimNode>(nodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(40)
        .strength(0.4),
    )
    .force('charge', forceManyBody<SimNode>().strength(-40).theta(0.9).distanceMax(320))
    .force('center', forceCenter<SimNode>(0, 0).strength(0.05))
    .force('x', forceX<SimNode>(0).strength(0.02))
    .force('y', forceY<SimNode>(0).strength(0.02))
    .force('collide', forceCollide<SimNode>((d) => radius(d.degree) + 2).strength(0.7))
    .alphaDecay(0.0228)
    .velocityDecay(0.4)
    .stop();
  if (timer !== null) clearTimeout(timer);
  loop();
}

self.addEventListener('message', (ev: MessageEvent<WorkerInbound>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    start(msg.nodes, msg.edges);
  } else if (msg.type === 'reheat' && sim) {
    sim.alpha(0.6).restart();
    if (timer === null) loop();
  }
});
