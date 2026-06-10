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
  run: () => void | Promise<void>;
}

/** 弹层结果行。命令 provider 下 id 即命令 id，经 registry.execute 执行。 */
export interface PaletteItem {
  id: string;
  title: string;
  shortcut?: string;
}

/**
 * 统一弹层前缀路由 provider（D-06）。
 * Phase 1 仅内置「>」命令 provider；Phase 2 挂无前缀快速打开 provider，壳不改。
 */
export interface PaletteProvider {
  prefix: string;
  getItems(query: string): PaletteItem[];
}
