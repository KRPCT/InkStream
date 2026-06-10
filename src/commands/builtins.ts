import { windowControls } from '../ipc/window';
import { usePaletteStore } from '../stores/usePaletteStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import type { Command } from '../types/commands';
import { bind } from './keymap';
import { register } from './registry';

/**
 * 内置命令（SHELL-04）：主题 x3（D-15）、视图 x4（D-12）、模式 x3（D-08）、应用：退出。
 * 标题字面照 01-UI-SPEC.md 命令注册表文案表；菜单与面板均从
 * registry.getAll() 取 title/shortcut（D-02 同源）。
 * 模式命令不占用全局快捷键（D-08：命令面板为主路，StatusBar 指示器为常驻入口）。
 */
const BUILTINS: Command[] = [
  {
    id: 'theme.light',
    title: '主题：亮色',
    run: () => useSettingsStore.getState().setTheme('light'),
  },
  {
    id: 'theme.dark',
    title: '主题：暗色',
    run: () => useSettingsStore.getState().setTheme('dark'),
  },
  {
    id: 'theme.system',
    title: '主题：跟随系统',
    run: () => useSettingsStore.getState().setTheme('system'),
  },
  {
    id: 'view.toggle-sidebar',
    title: '视图：切换侧边栏',
    shortcut: 'Ctrl+B',
    run: () => useWorkbenchStore.getState().toggleSidebar(),
  },
  {
    id: 'view.toggle-right-panel',
    title: '视图：切换右侧面板',
    shortcut: 'Ctrl+Alt+B',
    run: () => useWorkbenchStore.getState().toggleRightPanel(),
  },
  {
    id: 'view.reset-layout',
    title: '视图：重置当前模式布局',
    run: () => useWorkbenchStore.getState().resetCurrentLayout(),
  },
  {
    id: 'view.command-palette',
    title: '视图：命令面板',
    shortcut: 'Ctrl+Shift+P',
    run: () => usePaletteStore.getState().toggle(),
  },
  {
    id: 'mode.switch-standard',
    title: '模式：切换到 Standard（通用）',
    run: () => useWorkbenchStore.getState().setMode('standard'),
  },
  {
    id: 'mode.switch-academic',
    title: '模式：切换到 Academic（学术）',
    run: () => useWorkbenchStore.getState().setMode('academic'),
  },
  {
    id: 'mode.switch-creative',
    title: '模式：切换到 Creative（长篇创作）',
    run: () => useWorkbenchStore.getState().setMode('creative'),
  },
  {
    id: 'app.exit',
    title: '应用：退出',
    run: () => void windowControls.close(),
  },
];

let activeDispose: (() => void) | null = null;

/**
 * 启动时调用一次（main.tsx）。重复调用安全（StrictMode 纪律）：先清理旧注册。
 * 返回 dispose：注销全部内置命令与键位绑定。
 */
export function registerBuiltinCommands(): () => void {
  activeDispose?.();
  const disposers = [
    ...BUILTINS.map(register),
    bind('Ctrl+Shift+P', 'view.command-palette'),
    bind('Ctrl+B', 'view.toggle-sidebar'),
    bind('Ctrl+Alt+B', 'view.toggle-right-panel'),
  ];
  const dispose = (): void => {
    disposers.forEach((d) => d());
    if (activeDispose === dispose) activeDispose = null;
  };
  activeDispose = dispose;
  return dispose;
}
