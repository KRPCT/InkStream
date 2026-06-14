import { insertCitation, insertFootnote } from '../editor/academicActions';
import { expandBibliographyAs, insertOrExpandBibliography } from '../editor/bibliography';
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
  { id: 'academic.footnote', title: '学术：插入脚注', run: () => insertFootnote() },
  // 无占位 → 插入空占位；有占位 → 按文档已选样式展开/刷新（默认 GB/T 7714）。
  { id: 'academic.bibliography', title: '学术：插入参考文献', run: () => void insertOrExpandBibliography() },
  // 指定样式展开（写入 `<!-- biblio:STYLE -->` 标记，doc 即真相源）。
  { id: 'academic.biblio-gbt7714', title: '学术：参考文献（GB/T 7714）', run: () => void expandBibliographyAs('gbt7714') },
  { id: 'academic.biblio-apa', title: '学术：参考文献（APA）', run: () => void expandBibliographyAs('apa') },
  { id: 'academic.biblio-vancouver', title: '学术：参考文献（Vancouver）', run: () => void expandBibliographyAs('vancouver') },
];
