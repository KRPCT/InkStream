import { describe, expect, it } from 'vitest';
import type { Command } from '../types/commands';
import { matchCommands, rankCommands } from './match';

function cmd(id: string, title: string): Command {
  return { id, title, run: () => {} };
}

const commands = [
  cmd('theme.light', '主题：亮色'),
  cmd('theme.dark', '主题：暗色'),
  cmd('theme.system', '主题：跟随系统'),
  cmd('view.toggle-sidebar', '视图：切换侧边栏'),
];

describe('matchCommands', () => {
  it('中文 query 命中含该子串的标题', () => {
    expect(matchCommands('主题', ['主题：亮色', '视图：切换侧边栏'])).toEqual([0]);
  });

  it('非命中拉丁 query 返回空', () => {
    expect(matchCommands('qhcb', ['主题：亮色', '视图：切换侧边栏'])).toEqual([]);
  });

  it('空 query 返回全部索引', () => {
    expect(matchCommands('', ['甲', '乙', '丙'])).toEqual([0, 1, 2]);
  });
});

describe('rankCommands', () => {
  it('无 MRU 时按 uFuzzy 得分序返回命中命令', () => {
    const ranked = rankCommands('主题', commands, []);
    expect(ranked.map((c) => c.id)).toEqual(['theme.light', 'theme.dark', 'theme.system']);
  });

  it('MRU 命中项按 MRU 序置顶，其余跟随', () => {
    const ranked = rankCommands('主题', commands, ['theme.system', 'theme.dark']);
    expect(ranked.map((c) => c.id)).toEqual(['theme.system', 'theme.dark', 'theme.light']);
  });

  it('MRU 中未命中 query 的 id 不影响结果', () => {
    const ranked = rankCommands('主题', commands, ['view.toggle-sidebar']);
    expect(ranked.map((c) => c.id)).toEqual(['theme.light', 'theme.dark', 'theme.system']);
  });

  it('空 query 返回全部命令且 MRU 置顶', () => {
    const ranked = rankCommands('', commands, ['view.toggle-sidebar']);
    expect(ranked).toHaveLength(4);
    expect(ranked[0].id).toBe('view.toggle-sidebar');
  });
});
