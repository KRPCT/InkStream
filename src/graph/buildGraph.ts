import type { GraphEdgeData, GraphNodeData, VaultGraph } from './types';
import { createWikiResolver, wikiTargetPath } from '../editor/livepreview/wikiTarget';

/**
 * 由索引库 files + links 构建知识图谱（Phase 10 / LINK-06）。
 *
 * 边解析与点击导航/反链共用 wikiTarget 规则，显式路径与裸名歧义不会猜到另一份文档。
 */

/** 索引库 links 行的最小投影（图谱只需引用方与目标内核）。 */
export interface RawLink {
  source_path: string;
  target_raw: string;
}

function toSlash(p: string): string {
  return p.split('\\').join('/');
}

function stripMd(p: string): string {
  return p.replace(/\.(?:md|markdown)$/i, '');
}

function basename(p: string): string {
  const s = stripMd(toSlash(p));
  return s.split('/').pop() ?? s;
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

function adjOf(m: Map<string, Set<string>>, k: string): Set<string> {
  let s = m.get(k);
  if (!s) {
    s = new Set();
    m.set(k, s);
  }
  return s;
}

/**
 * 全库图谱：节点=所有 .md 文件（含孤立点），边=去重后的解析链接（排除自环与断链）。
 * 精确路径优先；裸名多个候选时不建边，保留与导航一致的歧义语义。
 */
export function buildVaultGraph(files: string[], links: RawLink[]): VaultGraph {
  const paths = files.map(toSlash);
  const known = new Set(paths);
  const entries = paths.map((path) => ({ path, name: path.split('/').pop() ?? path }));
  const resolve = createWikiResolver(entries);

  const seen = new Set<string>();
  const edges: GraphEdgeData[] = [];
  const degree = new Map<string, number>();
  for (const l of links) {
    const source = toSlash(l.source_path);
    if (!known.has(source)) continue;
    const target = resolve(wikiTargetPath(l.target_raw));
    if (target === null || target === source) continue;
    const key = `${source}\t${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ source, target });
    bump(degree, source);
    bump(degree, target);
  }
  const nodes: GraphNodeData[] = paths.map((p) => ({
    id: p,
    label: basename(p),
    degree: degree.get(p) ?? 0,
  }));
  return { nodes, edges };
}

/**
 * 局部图谱：以 center 为中心、depth 跳无向邻域（RightPanel Local Graph）。
 * 节点保留全库度数（反映全局重要度）；center 不在图中则返回空。
 */
export function localGraph(graph: VaultGraph, center: string, depth = 1): VaultGraph {
  const c = toSlash(center);
  const adj = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    adjOf(adj, e.source).add(e.target);
    adjOf(adj, e.target).add(e.source);
  }
  const keep = new Set<string>([c]);
  let frontier = [c];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of adj.get(u) ?? []) {
        if (!keep.has(v)) {
          keep.add(v);
          next.push(v);
        }
      }
    }
    frontier = next;
  }
  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  const edges = graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target));
  return { nodes, edges };
}
