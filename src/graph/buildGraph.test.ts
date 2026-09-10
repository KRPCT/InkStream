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

  it('裸名存在歧义时不猜首个目标，与点击导航一致', () => {
    const g = buildVaultGraph(
      ['y/note.md', 'x/note.md'],
      [{ source_path: 'y/note.md', target_raw: 'note' }],
    );
    expect(g.edges).toEqual([]);
  });

  it('显式目录缺失不能回退到别处同名文件', () => {
    const graph = buildVaultGraph(['a.md', 'note.md'], [{ source_path: 'a.md', target_raw: 'missing/note' }]);
    expect(graph.edges).toEqual([]);
  });

  it('片段剥离与NFC匹配保留实际文件身份', () => {
    const path = 'Cafe\u0301.md';
    const graph = buildVaultGraph(['a.md', path], [{ source_path: 'a.md', target_raw: 'Café#标题' }]);
    expect(graph.edges).toEqual([{ source: 'a.md', target: path }]);
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
