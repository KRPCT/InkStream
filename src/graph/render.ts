import type { VaultGraph, ZoomTransform } from './types';

/**
 * Graph View Canvas2D 绘制与命中（Phase 10）。纯绘制函数（无 React），主题色经 readGraphColors 从
 * CSS 变量解析为具体色（Canvas fillStyle 不认 var()）。世界坐标原点为图心，缩放/平移由 transform 决定。
 */

export interface GraphColors {
  bg: string;
  node: string;
  nodeActive: string;
  edge: string;
  label: string;
}

const FALLBACK: GraphColors = {
  bg: '#1e1e1e',
  node: '#888888',
  nodeActive: '#7aa2f7',
  edge: '#444444',
  label: '#cccccc',
};

export function nodeRadius(degree: number): number {
  return 3 + Math.min(8, Math.sqrt(degree) * 1.6);
}

/** 读主题 CSS 变量取具体色；jsdom / 无 CSS 时回退暗色默认（保测试与首帧不崩）。 */
export function readGraphColors(el: HTMLElement): GraphColors {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string): string => cs.getPropertyValue(name).trim() || fb;
  return {
    bg: v('--background-primary', FALLBACK.bg),
    node: v('--text-muted', FALLBACK.node),
    nodeActive: v('--accent', FALLBACK.nodeActive),
    edge: v('--background-modifier-border', FALLBACK.edge),
    label: v('--text-normal', FALLBACK.label),
  };
}

/** 命中检测：屏幕点命中的节点 id（最近且在半径内），无则 null。 */
export function hitTest(
  graph: VaultGraph,
  positions: Float32Array,
  t: ZoomTransform,
  sx: number,
  sy: number,
): string | null {
  const wx = (sx - t.x) / t.k;
  const wy = (sy - t.y) / t.k;
  let best: string | null = null;
  let bestD = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const dx = wx - positions[i * 2];
    const dy = wy - positions[i * 2 + 1];
    const r = nodeRadius(graph.nodes[i].degree) + 4;
    const d = dx * dx + dy * dy;
    if (d <= r * r && d < bestD) {
      bestD = d;
      best = graph.nodes[i].id;
    }
  }
  return best;
}

export interface DrawOpts {
  transform: ZoomTransform;
  colors: GraphColors;
  activeId: string | null;
  dim: Set<string> | null;
  showLabels: boolean;
}

/** 绘制整图（单层 Canvas2D；先按 dpr 缩放，再应用 zoom transform）。 */
export function drawGraph(
  ctx: CanvasRenderingContext2D,
  graph: VaultGraph,
  index: Map<string, number>,
  positions: Float32Array,
  cssW: number,
  cssH: number,
  dpr: number,
  opts: DrawOpts,
): void {
  const t = opts.transform;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = opts.colors.bg;
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.translate(t.x, t.y);
  ctx.scale(t.k, t.k);

  ctx.lineWidth = 1 / t.k;
  ctx.strokeStyle = opts.colors.edge;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  for (const e of graph.edges) {
    const si = index.get(e.source);
    const ti = index.get(e.target);
    if (si === undefined || ti === undefined) continue;
    ctx.moveTo(positions[si * 2], positions[si * 2 + 1]);
    ctx.lineTo(positions[ti * 2], positions[ti * 2 + 1]);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  for (let i = 0; i < graph.nodes.length; i++) {
    const n = graph.nodes[i];
    const dimmed = opts.dim !== null && opts.dim.has(n.id);
    ctx.globalAlpha = dimmed ? 0.2 : 1;
    ctx.fillStyle = n.id === opts.activeId ? opts.colors.nodeActive : opts.colors.node;
    ctx.beginPath();
    ctx.arc(positions[i * 2], positions[i * 2 + 1], nodeRadius(n.degree), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (opts.showLabels) {
    ctx.fillStyle = opts.colors.label;
    ctx.font = `${11 / t.k}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i];
      if (opts.dim !== null && opts.dim.has(n.id)) continue;
      ctx.fillText(n.label, positions[i * 2], positions[i * 2 + 1] + nodeRadius(n.degree) + 1 / t.k);
    }
  }
}
