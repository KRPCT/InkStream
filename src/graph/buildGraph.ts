import type { GraphEdgeData, GraphNodeData, VaultGraph } from './types';

/**
 * 由索引库 files + links 构建知识图谱（Phase 10 / LINK-06）。
 *
 * 边解析在查询期做：links.target_resolved 恒为 NULL（index.rs 注释），故沿用 indexService.queryBacklinks
 * 的三形态匹配（裸名 / 无扩展路径 / 全路径）的逆向——把每条 link 的 target_raw 解析到具体文件。纯函数，可单测。
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
  return p.endsWith('.md') ? p.slice(0, -3) : p;
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
 * 重名解析确定性：路径排序后首个占据裸名键；精确路径形态优先于裸名。
 */
export function buildVaultGraph(files: string[], links: RawLink[]): VaultGraph {
  const paths = files.map(toSlash);
  const known = new Set(paths);
  const byPathNoMd = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const p of [...paths].sort()) {
    byPathNoMd.set(stripMd(p), p);
    const name = basename(p);
    if (!byName.has(name)) byName.set(name, p);
  }
  const resolve = (raw: string): string | null => {
    const r = stripMd(toSlash(raw));
    return byPathNoMd.get(r) ?? byName.get(r) ?? null;
  };

  const seen = new Set<string>();
  const edges: GraphEdgeData[] = [];
  const degree = new Map<string, number>();
  for (const l of links) {
    const source = toSlash(l.source_path);
    if (!known.has(source)) continue;
    const target = resolve(l.target_raw);
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
