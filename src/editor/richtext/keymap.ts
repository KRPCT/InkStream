import { Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { insertLink, toggleBold, toggleItalic, wrapUnderline } from './commands';

/**
 * richtext 上下文 Ctrl+B/I/U/K 键位（D-16 + Ctrl+B 冲突裁决合约，UI-SPEC）。
 *
 * 冲突裁决：本 keymap 仅在 richtext 文档的 langCompartment 内激活（extensionsForLanguage
 * 'richtext' 注入），且 CM keymap 只在编辑器聚焦时分发——故
 * - richtext 文档 + 编辑器聚焦 → Ctrl+B = 加粗（命令 return true 拦截，CM 调 preventDefault，
 *   window 级 keymap.ts 的 onKeydown 因 e.defaultPrevented 不再触发视图命令）；
 * - 非 richtext 文档（无此 keymap）或编辑器未聚焦 → window 级 Ctrl+B 仍切侧栏（Phase 1 D 键位）。
 *
 * Prec.highest 保证抢在 defaultKeymap 之前（避免 Ctrl+I 等被基础键位吃掉）。
 * 命令均 return true：已处理，停止冒泡。
 */
export function richtextKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      { key: 'Ctrl-b', run: toggleBold, preventDefault: true },
      { key: 'Ctrl-i', run: toggleItalic, preventDefault: true },
      { key: 'Ctrl-u', run: wrapUnderline, preventDefault: true },
      { key: 'Ctrl-k', run: insertLink, preventDefault: true },
    ]),
  );
}
