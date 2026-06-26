import { matchCommands } from '../../commands/match';
import { scrollToHeading } from '../../editor/outline';
import { useOutlineStore } from '../../stores/useOutlineStore';
import type { PaletteItem, PaletteProvider } from '../../types/commands';

/** 层级缩进：用 en-space（U+2002），truncate 的 white-space:nowrap 会折叠/裁掉普通前导空格。 */
const INDENT = '  ';

/**
 * 当前文档标题跳转（命令面板 `@` 模式，v1.2 #2a，对标 Zed file finder 的 `@` 符号跳转）。
 *
 * 数据取自 useOutlineStore（CM 语法树持续镜像，单向纪律，无需另解析）；空 query 列全部标题（文档序），
 * 否则复用 match.ts uFuzzy（CJK 同源，绝不另写匹配）。title 按层级缩进、subtitle 标 H1-H6；id 用标题
 * 起始偏移（文档内唯一）。onSelect 经 outline.scrollToHeading 跳转（不抢焦点）。
 */
export const headingProvider: PaletteProvider = {
  prefix: '@',
  getItems: (query): PaletteItem[] => {
    const items = useOutlineStore.getState().items;
    const ranked = matchCommands(
      query.trim(),
      items.map((h) => h.text),
    );
    return ranked.map((i) => {
      const h = items[i];
      return {
        id: String(h.from),
        title: INDENT.repeat(Math.max(0, h.level - 1)) + (h.text || '（无标题）'),
        subtitle: `H${h.level}`,
      };
    });
  },
  onSelect: (id) => {
    scrollToHeading(Number(id));
  },
};
