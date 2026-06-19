import { describe, expect, it } from 'vitest';
import { buildVaultGraph, localGraph, type RawLink } from './buildGraph';

describe('buildVaultGraph', () => {
  const files = ['a.md', 'b.md', 'sub/c.md'];

  it('解析裸名与路径形态的边，计度数', () => {
    const links: RawLink[] = [
      { source_path: 'a.md', target_raw: 'b' }, // 裸名
      { source_path: 'b.md', target_raw: 'sub/c' }, // 无扩展路径
    ];
    const g = buildVaultGraph(files, links);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['a.md', 'b.md', 'sub/c.md']);
    expect(g.edges).toEqual([
      { source: 'a.md', target: 'b.md' },
      { source: 'b.md', target: 'sub/c.md' },
    ]);
    const deg = Object.fromEntries(g.nodes.map((n) => [n.id, n.degree]));
    expect(deg).toEqual({ 'a.md': 1, 'b.md': 2, 'sub/c.md': 1 });
  });

  it('去重重复边、丢弃自环与断链', () => {
    const links: RawLink[] = [
      { source_path: 'a.md', target_raw: 'b' },
      { source_path: 'a.md', target_raw: 'b' }, // 重复
      { source_path: 'a.md', target_raw: 'a' }, // 自环
      { source_path: 'a.md', target_raw: 'missing' }, // 断链
    ];
    const g = buildVaultGraph(files, links);
    expect(g.edges).toEqual([{ source: 'a.md', target: 'b.md' }]);
  });

  it('孤立文件仍作节点（degree 0）', () => {
    const g = buildVaultGraph(files, []);
    expect(g.edges).toEqual([]);
    expect(g.nodes.every((n) => n.degree === 0)).toBe(true);
    expect(g.nodes.find((n) => n.id === 'sub/c.md')?.label).toBe('c');
  });

  it('重名按路径排序确定性解析到首个', () => {
    const g = buildVaultGraph(
      ['y/note.md', 'x/note.md'],
      [{ source_path: 'y/note.md', target_raw: 'note' }],
    );
    // 'x/note.md' 排序在前，占据裸名键；y→note 解析到 x/note.md（非自环）
    expect(g.edges).toEqual([{ source: 'y/note.md', target: 'x/note.md' }]);
  });
});

describe('localGraph', () => {
  const files = ['a.md', 'b.md', 'sub/c.md', 'orphan.md'];
  const graph = buildVaultGraph(files, [
    { source_path: 'a.md', target_raw: 'b' },
    { source_path: 'b.md', target_raw: 'sub/c' },
  ]);

  it('depth 1 取直接邻域', () => {
    const lg = localGraph(graph, 'b.md', 1);
    expect(lg.nodes.map((n) => n.id).sort()).toEqual(['a.md', 'b.md', 'sub/c.md']);
  });

  it('depth 1 从端点只含一跳', () => {
    const lg = localGraph(graph, 'a.md', 1);
    expect(lg.nodes.map((n) => n.id).sort()).toEqual(['a.md', 'b.md']);
  });

  it('孤立中心只含自身', () => {
    const lg = localGraph(graph, 'orphan.md', 1);
    expect(lg.nodes.map((n) => n.id)).toEqual(['orphan.md']);
    expect(lg.edges).toEqual([]);
  });
});
