/**
 * 知识 Graph View 共享数据类型（Phase 10 / LINK-06）。
 *
 * 节点 = vault 内 .md 文件（id 为 '/' 分隔的相对路径）；边 = wiki-link 引用（解析到目标文件）。
 * 渲染走 d3-force 布局（Worker 化，见 graph/forceWorker.ts）+ Canvas2D 自绘（千级节点）。
 */

/** 图节点（纯数据；x/y 由布局 Worker 回写，渲染层只读）。 */
export interface GraphNodeData {
  /** 唯一键 = files.path（vault 相对路径，'/' 分隔）。 */
  id: string;
  /** 显示名（文件名去 .md）。 */
  label: string;
  /** 度数（入+出，无向计），用于节点大小与降级抽样。 */
  degree: number;
}

/** 图边（端点为节点 id，非对象引用——跨 Worker 边界须可结构化克隆）。 */
export interface GraphEdgeData {
  source: string;
  target: string;
}

/** 一张图谱（节点 + 边）。全库图与局部图同结构，仅数据集不同。 */
export interface VaultGraph {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
}

/** d3-zoom 变换：屏幕坐标 = k·世界 + (x,y)；世界原点为图心（forceCenter(0,0)）。 */
export interface ZoomTransform {
  x: number;
  y: number;
  k: number;
}

/**
 * 主线程 → 布局 Worker。节点按 init 顺序定索引，tick 回传坐标即按此序。
 * 边的 source/target 为节点 id（非对象引用——须可结构化克隆过 Worker 边界）。
 */
export type WorkerInbound =
  | { type: 'init'; nodes: Array<{ id: string; degree: number }>; edges: GraphEdgeData[] }
  | { type: 'reheat' };

/** 布局 Worker → 主线程。positions = [x0,y0,x1,y1,...]（init 节点序），buffer transfer 零拷贝。 */
export type WorkerOutbound = { type: 'tick'; positions: Float32Array } | { type: 'end' };
