import uFuzzy from '@leeoniya/ufuzzy';
import type { Command } from '../types/commands';

/**
 * CJK fuzzy 匹配（D-07）。uFuzzy 默认正则只认拉丁词：除 unicode: true 外还必须
 * 配套 README 的 \p{L} 类 inter/intra 选项（实测仅 unicode: true 命中不了中文）。
 * 几十条命令规模下 unicode 模式的性能损耗无感（01-RESEARCH.md）。
 */
const uf = new uFuzzy({
  unicode: true,
  interSplit: "[^\\p{L}\\d']+",
  intraSplit: '\\p{Ll}\\p{Lu}',
  intraBound: '\\p{L}\\d|\\d\\p{L}|\\p{Ll}\\p{Lu}',
  intraChars: "[\\p{L}\\d']",
  intraContr: "'\\p{L}{1,2}\\b",
});

/** 返回命中 titles 的索引（uFuzzy 得分序）；空 query 返回全部索引。 */
export function matchCommands(query: string, titles: string[]): number[] {
  if (query === '') return titles.map((_, i) => i);
  const idxs = uf.filter(titles, query);
  if (!idxs || idxs.length === 0) return [];
  const info = uf.info(idxs, titles, query);
  return uf.sort(info, titles, query).map((i) => info.idx[i]);
}

/** 纯函数排序：MRU 命中按 MRU 序置顶，其余按得分序（D-07，无分组标题）。 */
export function rankCommands(query: string, commands: Command[], mruIds: string[]): Command[] {
  const titles = commands.map((c) => c.title);
  const matched = matchCommands(query, titles).map((i) => commands[i]);
  const promoted = mruIds
    .map((id) => matched.find((c) => c.id === id))
    .filter((c): c is Command => c !== undefined);
  const rest = matched.filter((c) => !mruIds.includes(c.id));
  return [...promoted, ...rest];
}
