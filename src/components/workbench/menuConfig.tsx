import { execute } from '../../commands/registry';
import { switchVault } from '../../editor/vaultFlow';
import type { Command } from '../../types/commands';
import Kbd from '../common/Kbd';
import type { MenuEntry } from '../common/Menu';

/**
 * 菜单栏数据 + MenuEntry 转换（从 MenuBar 析出避免单文件超 200 行）。
 *
 * 菜单配置为纯数据（D-02 同源）：item 只存 commandId 与可选短标签，行为/标题/快捷键一律取自
 * registry——不在此定义任何 run。「最近打开」为运行时动态子菜单（recent，从 useVaultStore 构建），
 * 分隔线为 separator。竞品对标见 R4 §1（文件/编辑/段落/格式/视图/帮助六顶层）。
 * Phase 6 挂 Git Graph 入口 = 注册命令 + 在此加一行。
 */

interface ItemConfig {
  commandId: string;
  /** 菜单短标签；缺省用 registry 的命令全称。 */
  label?: string;
}

/** 分隔线（文件菜单退出区等，按竞品惯例 R4 §1.4）。 */
type SeparatorConfig = { separator: true };
/** 动态「最近打开」子菜单：运行时从 useVaultStore.recentVaults 构建。 */
type RecentConfig = { recent: true; label: string };
type SubmenuConfig = { label: string; submenu: ItemConfig[] };
type EntryConfig = ItemConfig | SubmenuConfig | SeparatorConfig | RecentConfig;

export interface GroupConfig {
  label: string;
  items: EntryConfig[];
}

export const MENUS: GroupConfig[] = [
  {
    label: '文件',
    items: [
      { commandId: 'file.new-document', label: '新建文档' },
      { commandId: 'file.new-file', label: '新建文件' },
      { commandId: 'file.new-folder', label: '新建文件夹' },
      { separator: true },
      { commandId: 'file.open-file', label: '打开文件…' },
      { commandId: 'file.open-folder', label: '打开文件夹…' },
      { recent: true, label: '最近打开' },
      { separator: true },
      { commandId: 'file.save', label: '保存' },
      { separator: true },
      { commandId: 'app.exit', label: '退出' },
    ],
  },
  {
    label: '编辑',
    items: [
      { commandId: 'edit.undo', label: '撤销' },
      { commandId: 'edit.redo', label: '重做' },
      { separator: true },
      { commandId: 'edit.cut', label: '剪切' },
      { commandId: 'edit.copy', label: '复制' },
      { commandId: 'edit.paste', label: '粘贴' },
      { commandId: 'edit.select-all', label: '全选' },
      { separator: true },
      { commandId: 'edit.find', label: '查找' },
      { commandId: 'edit.replace', label: '替换' },
    ],
  },
  {
    label: '段落',
    items: [
      {
        label: '标题',
        submenu: [
          { commandId: 'para.heading-1', label: '标题 1' },
          { commandId: 'para.heading-2', label: '标题 2' },
          { commandId: 'para.heading-3', label: '标题 3' },
          { commandId: 'para.heading-4', label: '标题 4' },
          { commandId: 'para.heading-5', label: '标题 5' },
          { commandId: 'para.heading-6', label: '标题 6' },
        ],
      },
      { commandId: 'para.paragraph', label: '正文' },
      { separator: true },
      { commandId: 'para.ul', label: '无序列表' },
      { commandId: 'para.ol', label: '有序列表' },
      { commandId: 'para.task', label: '任务列表' },
      { commandId: 'para.quote', label: '引用' },
      { separator: true },
      { commandId: 'para.table', label: '表格' },
      { commandId: 'para.code-fence', label: '代码块' },
      { commandId: 'para.math-block', label: '数学块' },
    ],
  },
  {
    label: '格式',
    items: [
      { commandId: 'fmt.bold', label: '加粗' },
      { commandId: 'fmt.italic', label: '斜体' },
      { commandId: 'fmt.code', label: '行内代码' },
      { commandId: 'fmt.strike', label: '删除线' },
      { commandId: 'fmt.highlight', label: '高亮' },
      { separator: true },
      { commandId: 'fmt.link', label: '插入链接…' },
      { commandId: 'fmt.image', label: '插入图片…' },
      { commandId: 'fmt.clear', label: '清除格式' },
    ],
  },
  {
    label: '视图',
    items: [
      { commandId: 'view.command-palette', label: '命令面板' },
      { commandId: 'go.quick-open', label: '快速打开文件' },
      { separator: true },
      { commandId: 'view.toggle-render-mode', label: '切换渲染模式' },
      { commandId: 'view.toggle-sidebar', label: '切换侧边栏' },
      { commandId: 'view.toggle-right-panel', label: '切换右侧面板' },
      { commandId: 'view.collapse-tree', label: '折叠文件树' },
      { separator: true },
      { commandId: 'git.toggle-graph', label: 'Git Graph' },
      { separator: true },
      { commandId: 'view.settings', label: '设置' },
      { separator: true },
      {
        label: '外观',
        submenu: [
          { commandId: 'theme.light' },
          { commandId: 'theme.dark' },
          { commandId: 'theme.system' },
        ],
      },
      {
        label: '模式',
        submenu: [
          { commandId: 'mode.switch-standard' },
          { commandId: 'mode.switch-academic' },
          { commandId: 'mode.switch-creative' },
        ],
      },
      { commandId: 'doc.toggle-language', label: '切换文档语言' },
    ],
  },
  {
    label: '帮助',
    items: [
      { commandId: 'app.about', label: '关于 InkStream' },
      { commandId: 'help.shortcuts', label: '快捷键参考' },
    ],
  },
];

/** 取路径末段作显示名（最近打开子菜单条目）。 */
function vaultName(path: string): string {
  const norm = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}

function toEntry(cfg: ItemConfig, commands: Map<string, Command>): MenuEntry {
  const cmd = commands.get(cfg.commandId);
  return {
    id: cfg.commandId,
    label: cfg.label ?? cmd?.title ?? cfg.commandId,
    disabled: cmd === undefined,
    trailing: cmd?.shortcut ? <Kbd tone="faint">{cmd.shortcut}</Kbd> : undefined,
    onSelect: () => void execute(cfg.commandId),
  };
}

/** 「最近打开 ▸」动态子菜单：逐项直连 switchVault；无最近项时整项 disabled。 */
function recentEntry(cfg: RecentConfig, recent: string[]): MenuEntry {
  if (recent.length === 0) return { id: 'recent-empty', label: cfg.label, disabled: true };
  return {
    id: 'recent',
    label: cfg.label,
    submenu: recent.map((path) => ({
      id: `recent:${path}`,
      label: vaultName(path),
      onSelect: () => void switchVault(path),
    })),
  };
}

/** 把一组菜单配置转 MenuEntry[]（处理分隔线 / 最近 / 子菜单 / 普通命令）。 */
export function toEntries(
  group: GroupConfig,
  commands: Map<string, Command>,
  recent: string[],
): MenuEntry[] {
  return group.items.map((item, i) => {
    if ('separator' in item) return { id: `sep-${group.label}-${i}`, label: '', separator: true };
    if ('recent' in item) return recentEntry(item, recent);
    if ('submenu' in item) {
      return {
        id: `submenu-${item.label}`,
        label: item.label,
        submenu: item.submenu.map((sub) => toEntry(sub, commands)),
      };
    }
    return toEntry(item, commands);
  });
}
