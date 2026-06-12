import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { wrapUnderline } from './commands';

/**
 * richtext 专属键位（仅 Ctrl+U 下划线 <u>，D-15 物理 HTML）。
 *
 * Ctrl+B/I（加粗/斜体）、Ctrl+K（链接）已统一并入 markdownEditKeymap（markdown 与 richtext
 * 同源，R4 §3 裁决），故本 keymap 只留 richtext 独有的 <u> 下划线，避免与 markdownEditKeymap
 * 重复绑定。智能 URL 粘贴仍由 richtextPasteExtension 承担。
 *
 * 仅在 richtext 文档的 langCompartment 内激活，且 CM keymap 只在编辑器聚焦时分发。
 * Prec.highest 保证抢在 defaultKeymap 之前。命令 return true：已处理，停止冒泡。
 */
export function richtextKeymap(): Extension {
  return Prec.highest(keymap.of([{ key: 'Ctrl-u', run: wrapUnderline, preventDefault: true }]));
}
