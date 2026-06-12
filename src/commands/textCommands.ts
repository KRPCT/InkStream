import {
  doCopy,
  doCut,
  doFind,
  doPaste,
  doRedo,
  doReplace,
  doSelectAll,
  doUndo,
} from '../editor/editCommands';
import {
  bold,
  bulletList,
  clearFormat,
  codeFence,
  highlight,
  inlineCode,
  insertImage,
  italic,
  link,
  mathBlock,
  orderedList,
  paragraph,
  quote,
  runMarkdownCommand,
  setHeading,
  strikethrough,
  table,
  taskList,
} from '../editor/markdownCommands';
import type { Command } from '../types/commands';

/**
 * 「编辑 / 段落 / 格式」命令定义（R4 §1.3，从 builtins 析出避免单文件超 200 行）。
 *
 * 编辑组经 editor/editCommands 派发到单内核 view（撤销/重做/剪贴板/查找）。
 * 段落/格式组经 runMarkdownCommand 派发——仅 markdown 家族文档生效（非 markdown 文档静默）。
 * 标题字面照 R4 §1.3 文案表；快捷键与 markdownEditKeymap 三处同源（R4 §3 键位裁决）。
 */

/** 段落/格式命令包装：CM Command → 仅 markdown 家族文档执行的 run。 */
const md = (cmd: Parameters<typeof runMarkdownCommand>[0]) => () => runMarkdownCommand(cmd);

export const EDIT_COMMANDS: Command[] = [
  { id: 'edit.undo', title: '编辑：撤销', shortcut: 'Ctrl+Z', run: doUndo },
  { id: 'edit.redo', title: '编辑：重做', shortcut: 'Ctrl+Y', run: doRedo },
  { id: 'edit.cut', title: '编辑：剪切', shortcut: 'Ctrl+X', run: doCut },
  { id: 'edit.copy', title: '编辑：复制', shortcut: 'Ctrl+C', run: doCopy },
  { id: 'edit.paste', title: '编辑：粘贴', shortcut: 'Ctrl+V', run: doPaste },
  { id: 'edit.select-all', title: '编辑：全选', shortcut: 'Ctrl+A', run: doSelectAll },
  { id: 'edit.find', title: '编辑：查找', shortcut: 'Ctrl+F', run: doFind },
  { id: 'edit.replace', title: '编辑：替换', shortcut: 'Ctrl+H', run: doReplace },
];

export const PARAGRAPH_COMMANDS: Command[] = [
  { id: 'para.heading-1', title: '段落：标题 1', shortcut: 'Ctrl+1', run: md(setHeading(1)) },
  { id: 'para.heading-2', title: '段落：标题 2', shortcut: 'Ctrl+2', run: md(setHeading(2)) },
  { id: 'para.heading-3', title: '段落：标题 3', shortcut: 'Ctrl+3', run: md(setHeading(3)) },
  { id: 'para.heading-4', title: '段落：标题 4', shortcut: 'Ctrl+4', run: md(setHeading(4)) },
  { id: 'para.heading-5', title: '段落：标题 5', shortcut: 'Ctrl+5', run: md(setHeading(5)) },
  { id: 'para.heading-6', title: '段落：标题 6', shortcut: 'Ctrl+6', run: md(setHeading(6)) },
  { id: 'para.paragraph', title: '段落：正文', shortcut: 'Ctrl+0', run: md(paragraph) },
  { id: 'para.ul', title: '段落：无序列表', shortcut: 'Ctrl+Shift+8', run: md(bulletList) },
  { id: 'para.ol', title: '段落：有序列表', shortcut: 'Ctrl+Shift+7', run: md(orderedList) },
  { id: 'para.task', title: '段落：任务列表', run: md(taskList) },
  { id: 'para.quote', title: '段落：引用', shortcut: 'Ctrl+Shift+Q', run: md(quote) },
  { id: 'para.table', title: '段落：表格', shortcut: 'Ctrl+T', run: md(table) },
  { id: 'para.code-fence', title: '段落：代码块', shortcut: 'Ctrl+Shift+K', run: md(codeFence) },
  { id: 'para.math-block', title: '段落：数学块', shortcut: 'Ctrl+Shift+M', run: md(mathBlock) },
];

export const FORMAT_COMMANDS: Command[] = [
  { id: 'fmt.bold', title: '格式：加粗', shortcut: 'Ctrl+B', run: md(bold) },
  { id: 'fmt.italic', title: '格式：斜体', shortcut: 'Ctrl+I', run: md(italic) },
  { id: 'fmt.code', title: '格式：行内代码', shortcut: 'Ctrl+Shift+`', run: md(inlineCode) },
  { id: 'fmt.strike', title: '格式：删除线', shortcut: 'Alt+Shift+5', run: md(strikethrough) },
  { id: 'fmt.highlight', title: '格式：高亮', shortcut: 'Ctrl+Shift+H', run: md(highlight) },
  { id: 'fmt.link', title: '格式：插入链接', shortcut: 'Ctrl+K', run: md(link) },
  { id: 'fmt.image', title: '格式：插入图片', shortcut: 'Ctrl+Shift+I', run: md(insertImage) },
  { id: 'fmt.clear', title: '格式：清除格式', run: md(clearFormat) },
];

/** 编辑/段落/格式命令全集（builtins 注册时并入）。 */
export const TEXT_COMMANDS: Command[] = [
  ...EDIT_COMMANDS,
  ...PARAGRAPH_COMMANDS,
  ...FORMAT_COMMANDS,
];
