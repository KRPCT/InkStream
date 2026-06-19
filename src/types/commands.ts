/**
 * 命令系统类型契约（01-RESEARCH.md Pattern 3，Plan 05+ 消费）。
 * 注册表/命令面板/菜单（Plan 05）均从 registry.getAll() 同源消费（D-02），绝不另建定义。
 */

export interface Command {
  /** 'theme.dark' / 'view.toggle-sidebar' 等点分命名。 */
  id: string;
  /** 简体中文显示名，字面照 01-UI-SPEC.md 命令注册表文案表。 */
  title: string;
  /** 仅展示用（面板右侧 kbd 芯片）；分发由 keymap.ts 负责。 */
  shortcut?: string;
  /**
   * 高级功能命令：简易模式（useSettingsStore.simpleMode）下不在命令面板 / 菜单出现，
   * 且经 registry.execute（含快捷键 Ctrl+G/Ctrl+Shift+G、菜单点击）触发一律 no-op。
   * 覆盖知识图谱 / Git Graph / 模式切换 / 学术引用 / 切换文档语言等依赖高级子系统的命令。
   */
  advanced?: boolean;
  run: () => void | Promise<void>;
}

/** 弹层结果行。命令 provider 下 id 即命令 id，经 registry.execute 执行。 */
export interface PaletteItem {
  id: string;
  title: string;
  shortcut?: string;
  /** 次要文本（快速打开结果行右侧灰色相对路径，Label 12 `--text-faint`）。 */
  subtitle?: string;
}

/**
 * 统一弹层前缀路由 provider（D-06）。
 * Phase 1 仅内置「>」命令 provider；Phase 2 挂无前缀快速打开 provider，壳不改。
 */
export interface PaletteProvider {
  prefix: string;
  getItems(query: string): PaletteItem[];
  /**
   * 选中结果行的处理（可选）。缺省时由弹层壳走 registry.execute(item.id)（命令 provider）；
   * 文件 provider 提供此回调以打开文件而非执行命令（id 为相对路径）。
   */
  onSelect?(id: string): void;
}
