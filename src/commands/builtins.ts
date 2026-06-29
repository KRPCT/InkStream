import { registerImeProbeCommand } from '../components/dev/imeProbeCommand';
import type { Command } from '../types/commands';
import { ACADEMIC_COMMANDS } from './academicCommands';
import { BOOKSHELF_COMMANDS } from './bookshelfCommands';
import { CORE_COMMANDS } from './coreCommands';
import { EXPORT_COMMANDS } from './exportCommands';
import { GIT_COMMANDS } from './gitCommands';
import { bind } from './keymap';
import { register } from './registry';
import { TEXT_COMMANDS } from './textCommands';
import { VIEW_COMMANDS } from './viewCommands';

/**
 * 内置命令注册入口（SHELL-04）。命令定义按职责分两处（D-02 同源，均经 registry.getAll() 消费）：
 *   coreCommands — 主题/视图/模式/文件/文档/应用/帮助；
 *   textCommands — 编辑/段落/格式（R4 §1.3，接 CM6）。
 * 本文件只做合并 + window 级键位绑定 + StrictMode 安全的 dispose 管理（拆分自避免单文件超 200 行）。
 */
const BUILTINS: Command[] = [
  ...CORE_COMMANDS,
  ...VIEW_COMMANDS,
  ...EXPORT_COMMANDS,
  ...TEXT_COMMANDS,
  ...GIT_COMMANDS,
  ...ACADEMIC_COMMANDS,
  ...BOOKSHELF_COMMANDS,
];

let activeDispose: (() => void) | null = null;

/**
 * 启动时调用一次（main.tsx）。重复调用安全（StrictMode 纪律）：先清理旧注册。
 * 返回 dispose：注销全部内置命令与键位绑定。
 *
 * 键位裁决（R4 §3，UAT 待用户确认）：侧栏让位 Ctrl+B → Ctrl+\；Ctrl+O = 打开文件、
 * Ctrl+Shift+O = 打开文件夹；渲染模式保留 Ctrl+E。编辑/段落/格式键由 CM markdownEditKeymap
 * 在编辑器聚焦时分发，不在此 window 级绑定，避免与 CM 键位双触发。
 */
export function registerBuiltinCommands(): () => void {
  activeDispose?.();
  const disposers = [
    ...BUILTINS.map(register),
    bind('Ctrl+Shift+P', 'view.command-palette'),
    bind('Ctrl+,', 'view.settings'),
    bind('Ctrl+P', 'go.quick-open'),
    bind('Ctrl+\\', 'view.toggle-sidebar'),
    bind('Ctrl+Alt+B', 'view.toggle-right-panel'),
    bind('Ctrl+N', 'file.new-document'),
    bind('Ctrl+Alt+N', 'file.new-file'),
    bind('Ctrl+O', 'file.open-file'),
    bind('Ctrl+Shift+O', 'file.open-folder'),
    bind('Ctrl+S', 'file.save'),
    bind('Ctrl+E', 'view.toggle-render-mode'),
    bind('Ctrl+G', 'view.open-graph'),
    bind('Ctrl+Shift+F', 'view.project-search'),
    bind('Ctrl+`', 'view.toggle-terminal'),
    // 界面缩放（v1.2.1）：Ctrl+= 放大 / Ctrl+- 缩小 / Ctrl+0 重置。keymap 解析器无法表达 Ctrl++
    // （字面 split 切出空 main 键），故放大用 Ctrl+=（浏览器同惯例）。Ctrl+0 与 CM 的「段落」命令
    // 同键但不冲突：markdown 编辑器聚焦时 CM keymap 先处理并 preventDefault → 本 window 级 onKeydown
    // 见 defaultPrevented 即短路（段落优先，无回归）；仅在非 markdown 编辑 / 未聚焦时落到此处重置缩放。
    bind('Ctrl+=', 'view.zoom-in'),
    bind('Ctrl+-', 'view.zoom-out'),
    bind('Ctrl+0', 'view.zoom-reset'),
    bind('Ctrl+Shift+G', 'git.toggle-graph'),
    // ZOT-01：编辑器聚焦时由 CM6 keymap 处理（preventDefault → 本 window 级短路不重复）；
    // 编辑器未聚焦时本绑定兜底触发，insertCitation 经 getView() 仍插入到编辑器光标处。
    bind('Ctrl+Shift+Z', 'academic.cite'),
    // DEV-only：IME 输入探针命令（R2 实验入口）。非 DEV 为 no-op，不进注册表。
    registerImeProbeCommand(),
  ];
  const dispose = (): void => {
    disposers.forEach((d) => d());
    if (activeDispose === dispose) activeDispose = null;
  };
  activeDispose = dispose;
  return dispose;
}
