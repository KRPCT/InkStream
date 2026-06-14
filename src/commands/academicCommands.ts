import { insertCitation } from '../editor/academicActions';
import type { Command } from '../types/commands';

/**
 * 学术命令组（Phase 8 ZOT / ACAD）。引用/参考文献/脚注等学术写作动作，接 Zotero + Typst。
 * 与 core/text/git 同源经 registry.getAll() 消费（D-02）。
 *
 * 键位裁决（ZOT-01）：Ctrl+Shift+Z = 插入引用。与 CM6 historyKeymap 的 redo 冲突，
 * 由编辑器 keymap 高优先级覆盖（extensions.ts），redo 改走 Ctrl+Y。shortcut 仅展示。
 */
export const ACADEMIC_COMMANDS: Command[] = [
  {
    id: 'academic.cite',
    title: '学术：插入引用（Zotero）',
    shortcut: 'Ctrl+Shift+Z',
    run: () => void insertCitation(),
  },
];
