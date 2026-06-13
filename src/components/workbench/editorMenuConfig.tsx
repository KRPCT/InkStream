import { execute } from '../../commands/registry';
import type { Command } from '../../types/commands';
import { applyTableOp, type TableOp } from '../../editor/livepreview/tableCommands';
import { getView } from '../../editor/viewHandle';
import Kbd from '../common/Kbd';
import type { MenuEntry } from '../common/Menu';

/**
 * 编辑器右键菜单结构（R4 §4.3，Typora 基准）：剪贴板 + 格式▸ + 段落▸ + 插入▸ + 查找。
 *
 * 纯数据 + commandId（D-02 同源）：行为/标题/快捷键全取自 registry，与 MenuBar 同框架（menuConfig）。
 * 段落/格式/插入项复用既有 para.* 与 fmt.* 命令（U2 已注册并接 CM6 markdownCommands），零新命令。
 * markdown 家族判据由调用方（EditorContextMenu）统一 disabled 这三个子菜单。
 */

interface Item {
  commandId: string;
  label: string;
}

const sep = (id: string): MenuEntry => ({ id, label: '', separator: true });

/** commandId → MenuEntry（标题/快捷键取自 registry，trailing 显 Kbd 芯片）。 */
function entry(cfg: Item, commands: Map<string, Command>, onRun: () => void): MenuEntry {
  const cmd = commands.get(cfg.commandId);
  return {
    id: cfg.commandId,
    label: cfg.label,
    disabled: cmd === undefined,
    trailing: cmd?.shortcut ? <Kbd tone="faint">{cmd.shortcut}</Kbd> : undefined,
    onSelect: () => {
      void execute(cfg.commandId);
      onRun();
    },
  };
}

/** 构建编辑器右键菜单项（onRun 在每次叶子选择后回调，供调用方记录/关闭）。 */
export function buildEditorMenu(
  commands: Map<string, Command>,
  markdownFamily: boolean,
  onRun: () => void,
): MenuEntry[] {
  const e = (cfg: Item): MenuEntry => entry(cfg, commands, onRun);
  const sub = (id: string, label: string, items: Item[]): MenuEntry => ({
    id,
    label,
    // 非 markdown 文档（.py/.rs 等）禁用段落/格式/插入（markdownCommands 本就静默 no-op，
    // 此处显式 disabled 给用户明确反馈，R4 §4.3）。
    disabled: !markdownFamily,
    submenu: items.map(e),
  });

  return [
    e({ commandId: 'edit.cut', label: '剪切' }),
    e({ commandId: 'edit.copy', label: '复制' }),
    e({ commandId: 'edit.paste', label: '粘贴' }),
    e({ commandId: 'edit.select-all', label: '全选' }),
    sep('ctx-sep-1'),
    sub('ctx-format', '格式', [
      { commandId: 'fmt.bold', label: '加粗' },
      { commandId: 'fmt.italic', label: '斜体' },
      { commandId: 'fmt.code', label: '行内代码' },
      { commandId: 'fmt.strike', label: '删除线' },
    ]),
    sub('ctx-paragraph', '段落', [
      { commandId: 'para.heading-1', label: '标题 1' },
      { commandId: 'para.heading-2', label: '标题 2' },
      { commandId: 'para.heading-3', label: '标题 3' },
      { commandId: 'para.paragraph', label: '正文' },
      { commandId: 'para.quote', label: '引用' },
      { commandId: 'para.ul', label: '无序列表' },
      { commandId: 'para.ol', label: '有序列表' },
      { commandId: 'para.task', label: '任务列表' },
    ]),
    sub('ctx-insert', '插入', [
      { commandId: 'para.table', label: '表格' },
      { commandId: 'fmt.link', label: '链接' },
      { commandId: 'fmt.image', label: '图片' },
      { commandId: 'para.math-block', label: '数学块' },
    ]),
    sep('ctx-sep-2'),
    e({ commandId: 'edit.find', label: '查找' }),
  ];
}

/** 右键命中的表格上下文（表格身份键 + 单元格下标）；非表格内右键则 null。 */
export interface TableMenuContext {
  readonly tableFrom: number;
  readonly cellIndex: number;
}

/** 表格 op 菜单项规格（标签 + op）。 */
interface TableItem {
  readonly id: string;
  readonly label: string;
  readonly op: TableOp;
}

/** 表格操作菜单项（右键命中表格时追加；§5 同一命令层 applyTableOp，与工具条同源）。 */
const TABLE_ITEMS: readonly (TableItem | 'sep')[] = [
  { id: 'tbl-row-above', label: '在上方插入行', op: { kind: 'insertRowAbove' } },
  { id: 'tbl-row-below', label: '在下方插入行', op: { kind: 'insertRowBelow' } },
  { id: 'tbl-row-del', label: '删除当前行', op: { kind: 'deleteRow' } },
  'sep',
  { id: 'tbl-col-left', label: '在左侧插入列', op: { kind: 'insertColLeft' } },
  { id: 'tbl-col-right', label: '在右侧插入列', op: { kind: 'insertColRight' } },
  { id: 'tbl-col-del', label: '删除当前列', op: { kind: 'deleteCol' } },
  'sep',
  { id: 'tbl-align-left', label: '左对齐', op: { kind: 'align', align: 'left' } },
  { id: 'tbl-align-center', label: '居中对齐', op: { kind: 'align', align: 'center' } },
  { id: 'tbl-align-right', label: '右对齐', op: { kind: 'align', align: 'right' } },
];

/**
 * 表格操作子菜单（右键菜单追加）：仅当右键命中表格内（ctx 非空）才生成。
 *
 * 每项经 applyTableOp 走与工具条同一命令层（双入口同源，§5）；目标 = 右键命中的 tableFrom + cellIndex。
 * 返回 [分隔, 「表格」子菜单] 追加到主菜单尾；ctx 为 null 返回空数组（普通右键不显表格项）。
 */
export function buildTableMenuEntries(
  ctx: TableMenuContext | null,
  onRun: () => void,
): MenuEntry[] {
  if (!ctx) return [];
  const items: MenuEntry[] = TABLE_ITEMS.map((it, i) =>
    it === 'sep'
      ? { id: `tbl-sep-${i}`, label: '', separator: true }
      : {
          id: it.id,
          label: it.label,
          onSelect: () => {
            const view = getView();
            if (view) applyTableOp(view, ctx.tableFrom, ctx.cellIndex, it.op);
            onRun();
          },
        },
  );
  return [sep('ctx-sep-table'), { id: 'ctx-table', label: '表格', submenu: items }];
}
