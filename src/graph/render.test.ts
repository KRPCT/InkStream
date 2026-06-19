import { describe, expect, it } from 'vitest';
import { hitTest, nodeRadius } from './render';
import type { VaultGraph, ZoomTransform } from './types';

const graph: VaultGraph = {
  nodes: [
    { id: 'a.md', label: 'a', degree: 0 },
    { id: 'b.md', label: 'b', degree: 4 },
  ],
  edges: [],
};
// a 在世界 (0,0)，b 在世界 (100,0)
const positions = new Float32Array([0, 0, 100, 0]);
const identity: ZoomTransform = { x: 0, y: 0, k: 1 };

describe('hitTest', () => {
  it('命中节点中心（identity 变换）', () => {
    expect(hitTest(graph, positions, identity, 0, 0)).toBe('a.md');
    expect(hitTest(graph, positions, identity, 100, 0)).toBe('b.md');
  });

  it('空白处返回 null', () => {
    expect(hitTest(graph, positions, identity, 50, 50)).toBeNull();
  });

  it('应用 zoom 变换后命中正确（屏幕→世界逆变换）', () => {
    const t: ZoomTransform = { x: 10, y: 10, k: 2 };
    expect(hitTest(graph, positions, t, 10, 10)).toBe('a.md'); // 世界(0,0)→屏幕(10,10)
    expect(hitTest(graph, positions, t, 210, 10)).toBe('b.md'); // 世界(100,0)→屏幕(210,10)
  });
});

describe('nodeRadius', () => {
  it('度数越大半径越大且有上界', () => {
    expect(nodeRadius(4)).toBeGreaterThan(nodeRadius(0));
    expect(nodeRadius(10_000)).toBeLessThanOrEqual(11);
  });
});
