import type { OutlineItem } from '../types/editor';

/**
 * 大纲拖拽重排章节（v1.2 #2d）的纯计算层（无 CM / store 依赖，可独立单测）。
 *
 * 「节」= 一个标题及其全部下级内容，直到下一个**同级或更浅**标题（或文末）——故拖一个 H1 连带其下所有
 * 子节一起移动（尊重语法树块边界）。移动落实为一次 dispatch 的两段改动（删源 + 在目标处插入），坐标一律
 * 原 doc UTF-16 偏移、互不重叠，由 CM6 ChangeSet 一致映射。换行规整保证标题始终独占整行、不与邻行并行。
 */

export interface SectionMove {
  /** 单次 dispatch 的 changes（升序、互不重叠：删源段 {from,to} + 目标处插入 {from,insert}）。 */
  changes: Array<{ from: number; to?: number; insert?: string }>;
  /** 移动后被移动标题在新 doc 中的起始偏移（光标定位用）。 */
  caret: number;
}

/** 各标题节的 [from, to) 区间（to = 下一个同级/更浅标题的 from，或文末）。items 须按 from 升序（文档序）。 */
export function sectionRanges(items: OutlineItem[], docLength: number): Array<{ from: number; to: number }> {
  return items.map((it, i) => {
    let end = docLength;
    for (let j = i + 1; j < items.length; j++) {
      if (items[j].level <= it.level) {
        end = items[j].from;
        break;
      }
    }
    return { from: it.from, to: end };
  });
}

/**
 * 计算把 fromIndex 节移动到「toIndex 节之前」（toIndex===items.length 即移到文末）的 doc 改动。
 *
 * 返回 null：索引越界 / 落点落在源节区间内或其两端（拖入自身子树、或紧邻同位的 no-op）。
 * 换行规整：被移动块末尾确保有 '\n'（插到下一标题前不并行）；落点前一字符非换行时块前补 '\n'（与前文分隔）。
 */
export function computeSectionMove(
  doc: string,
  items: OutlineItem[],
  fromIndex: number,
  toIndex: number,
): SectionMove | null {
  if (fromIndex < 0 || fromIndex >= items.length) return null;
  if (toIndex < 0 || toIndex > items.length) return null;
  const ranges = sectionRanges(items, doc.length);
  const src = ranges[fromIndex];
  const dest = toIndex < items.length ? items[toIndex].from : doc.length;
  // 落点在源节 [from,to] 闭区间内：拖入自身/子树（非法）或紧邻同位（no-op）——一律不动。
  if (dest >= src.from && dest <= src.to) return null;

  let text = doc.slice(src.from, src.to);
  if (!text.endsWith('\n')) text += '\n'; // 末尾补换行：插到下一标题前不并行。
  const prefix = dest > 0 && doc[dest - 1] !== '\n' ? '\n' : ''; // 落点前非行首 → 块前补换行分隔。
  const insert = prefix + text;

  const del = { from: src.from, to: src.to };
  const ins = { from: dest, insert };
  // 升序排列两段改动（dest 与源段必不相邻重叠，前置守卫已排除 dest∈[from,to]）。
  const changes = dest < src.from ? [ins, del] : [del, ins];

  // 被移动标题在新 doc 的起点：块内偏移 prefix.length 落在 dest；若 dest 在源段之后，删源使其整体左移源段长度。
  const moved = src.to - src.from;
  const caret = dest > src.to ? dest - moved + prefix.length : dest + prefix.length;
  return { changes, caret };
}
