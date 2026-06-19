import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom';
import { useEffect, useMemo, useRef } from 'react';
import { GraphLayout } from './graphClient';
import { drawGraph, hitTest, readGraphColors, type GraphColors } from './render';
import type { VaultGraph, ZoomTransform } from './types';

/** 节点数 ≤ 此值恒显标签；否则需缩放到 LABEL_ZOOM 才显（大图降级，避标签糊屏）。 */
const LABEL_NODE_CAP = 120;
const LABEL_ZOOM = 1.4;
/** 节点数 ≤ 此值才在 hover 时计算邻域淡化；超阈只高亮不淡化（避大图 O(n) 重算）。 */
const HOVER_DIM_CAP = 2000;

export interface GraphCanvasProps {
  graph: VaultGraph;
  /** 高亮的活动文件 id（编辑器当前文件）；无匹配则不高亮。 */
  activeId: string | null;
  onOpen: (id: string) => void;
}

interface CanvasState {
  transform: ZoomTransform;
  hover: string | null;
  dim: Set<string> | null;
  activeId: string | null;
  colors: GraphColors | null;
  layout: GraphLayout | null;
  size: { w: number; h: number; dpr: number };
  centered: boolean;
  rafPending: boolean;
  requestDraw: () => void;
}

/**
 * 知识图谱 Canvas（Phase 10 / LINK-06）。布局在 Worker（graphClient），本组件按 dpr 自适应尺寸、
 * d3-zoom 拖拽平移 + 滚轮缩放、命中检测点击打开、hover 高亮邻域（淡化结果随 hover 变化记忆，非每帧重算）。
 * 首个有效尺寸时居中并同步 d3-zoom；主题/模式切换时重读 Canvas 色重绘。可变态存 ref 不进 React state。
 * 打开图谱不抢编辑器焦点（IME 安全：覆盖层不卸载编辑器）。
 */
export default function GraphCanvas({ graph, activeId, onOpen }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const stRef = useRef<CanvasState>({
    transform: { x: 0, y: 0, k: 1 },
    hover: null,
    dim: null,
    activeId,
    colors: null,
    layout: null,
    size: { w: 0, h: 0, dpr: 1 },
    centered: false,
    rafPending: false,
    requestDraw: () => {},
  });

  // index / adjacency 为 graph 的纯派生物，恒以 [graph] memo——必须与 graph 同生命周期，
  // 否则会在主 effect 的依赖里误触 Worker 重建（丢已收敛布局）。
  const index = useMemo(() => {
    const m = new Map<string, number>();
    graph.nodes.forEach((n, i) => m.set(n.id, i));
    return m;
  }, [graph]);
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string): void => {
      let set = m.get(a);
      if (!set) {
        set = new Set();
        m.set(a, set);
      }
      set.add(b);
    };
    for (const e of graph.edges) {
      add(e.source, e.target);
      add(e.target, e.source);
    }
    return m;
  }, [graph]);

  useEffect(() => {
    stRef.current.activeId = activeId;
    stRef.current.requestDraw();
  }, [activeId]);

  // 主题/模式切换：Graph 覆盖层不随 theme/mode 重挂，须显式重读 Canvas 色（var() 不进 Canvas）并重绘。
  useEffect(() => {
    const refresh = (): void => {
      const c = canvasRef.current;
      if (!c) return;
      stRef.current.colors = readGraphColors(c);
      stRef.current.requestDraw();
    };
    const mo = new MutationObserver(refresh);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = stRef.current;
    s.colors = readGraphColors(canvas);
    s.centered = false;
    let rafId: number | null = null;

    const draw = (): void => {
      const pos = s.layout?.getPositions();
      const ctx = canvas.getContext('2d');
      if (!pos || !s.colors || !ctx) return;
      const showLabels = graph.nodes.length <= LABEL_NODE_CAP || s.transform.k >= LABEL_ZOOM;
      drawGraph(ctx, graph, index, pos, s.size.w, s.size.h, s.size.dpr, {
        transform: s.transform,
        colors: s.colors,
        activeId: s.activeId,
        dim: s.dim,
        showLabels,
      });
    };
    const requestDraw = (): void => {
      if (s.rafPending) return;
      s.rafPending = true;
      rafId = requestAnimationFrame(() => {
        s.rafPending = false;
        rafId = null;
        draw();
      });
    };
    s.requestDraw = requestDraw;

    const sel = select(canvas);
    const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 6])
      .on('zoom', (ev: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        s.transform = { x: ev.transform.x, y: ev.transform.y, k: ev.transform.k };
        requestDraw();
      });
    sel.call(zoomBehavior);

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      s.size = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      if (!s.centered && rect.width > 0 && rect.height > 0) {
        s.transform = { x: rect.width / 2, y: rect.height / 2, k: 1 };
        sel.call(zoomBehavior.transform, zoomIdentity.translate(s.transform.x, s.transform.y));
        s.centered = true;
      }
      requestDraw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    s.layout = new GraphLayout(graph, requestDraw);

    const hitAt = (e: MouseEvent): string | null => {
      const pos = s.layout?.getPositions();
      if (!pos) return null;
      const rect = canvas.getBoundingClientRect();
      return hitTest(graph, pos, s.transform, e.clientX - rect.left, e.clientY - rect.top);
    };
    const setHover = (id: string | null): void => {
      if (id === s.hover) return;
      s.hover = id;
      if (id && graph.nodes.length <= HOVER_DIM_CAP) {
        const keep = new Set<string>([id, ...(adjacency.get(id) ?? [])]);
        s.dim = new Set(graph.nodes.map((n) => n.id).filter((x) => !keep.has(x)));
      } else {
        s.dim = null;
      }
      canvas.style.cursor = id ? 'pointer' : 'grab';
      requestDraw();
    };
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: MouseEvent): void => {
      downAt = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: MouseEvent): void => setHover(hitAt(e));
    const onLeave = (): void => setHover(null);
    const onClick = (e: MouseEvent): void => {
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
      const id = hitAt(e);
      if (id) onOpenRef.current(id);
    };
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('click', onClick);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      s.rafPending = false;
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onClick);
      sel.on('.zoom', null);
      s.layout?.dispose();
      s.layout = null;
      s.dim = null;
      s.hover = null;
      s.requestDraw = () => {};
    };
  }, [graph, index, adjacency]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="graph-canvas"
      className="block h-full w-full"
      style={{ cursor: 'grab' }}
    />
  );
}
