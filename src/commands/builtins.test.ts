import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { windowControls } from '../ipc/window';
import { useAboutStore } from '../stores/useAboutStore';
import { usePaletteStore } from '../stores/usePaletteStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { DEFAULT_LAYOUT } from '../types/workbench';
import { registerBuiltinCommands } from './builtins';
import { dispose as disposeKeymap, init as initKeymap } from './keymap';
import { hydrate } from './mru';
import { execute, getAll } from './registry';

/** UI-SPEC 命令注册表文案表字面（含 TitleBar 菜单条目的命令面板/退出）。 */
const TITLES: Record<string, string> = {
  'theme.light': '主题：亮色',
  'theme.dark': '主题：暗色',
  'theme.system': '主题：跟随系统',
  'view.toggle-sidebar': '视图：切换侧边栏',
  'view.toggle-right-panel': '视图：切换右侧面板',
  'view.reset-layout': '视图：重置当前模式布局',
  'view.command-palette': '视图：命令面板',
  'file.open-folder': '文件：打开文件夹',
  'go.quick-open': '转到：快速打开文件',
  'app.exit': '应用：退出',
  'mode.switch-standard': '模式：切换到 Standard（通用）',
  'mode.switch-academic': '模式：切换到 Academic（学术）',
  'mode.switch-creative': '模式：切换到 Creative（长篇创作）',
  'app.about': '帮助：关于 InkStream',
};

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init });
}

let disposeBuiltins: () => void;

describe('builtins', () => {
  beforeEach(() => {
    hydrate([]);
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    usePaletteStore.setState(usePaletteStore.getInitialState(), true);
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.mode;
    disposeBuiltins = registerBuiltinCommands();
  });

  afterEach(() => {
    disposeBuiltins();
    disposeKeymap();
  });

  it('注册 14 条命令，标题与 UI-SPEC 字面逐字一致', () => {
    const all = getAll();
    expect(all).toHaveLength(14);
    for (const [id, title] of Object.entries(TITLES)) {
      expect(all.find((c) => c.id === id)?.title).toBe(title);
    }
  });

  it('快捷键提示与键盘表一致', () => {
    const byId = new Map(getAll().map((c) => [c.id, c]));
    expect(byId.get('view.toggle-sidebar')?.shortcut).toBe('Ctrl+B');
    expect(byId.get('view.toggle-right-panel')?.shortcut).toBe('Ctrl+Alt+B');
    expect(byId.get('view.command-palette')?.shortcut).toBe('Ctrl+Shift+P');
    expect(byId.get('go.quick-open')?.shortcut).toBe('Ctrl+P');
  });

  it('重复调用安全（StrictMode）：先清旧注册再登记', () => {
    expect(() => {
      disposeBuiltins = registerBuiltinCommands();
    }).not.toThrow();
    expect(getAll()).toHaveLength(14);
  });

  it('合成 Ctrl+P 经 keymap 打开无前缀快速打开', () => {
    initKeymap();
    window.dispatchEvent(key({ key: 'p', ctrlKey: true }));
    expect(usePaletteStore.getState().open).toBe(true);
    expect(usePaletteStore.getState().query).toBe('');
  });

  it('execute mode.switch-academic 切换模式且不占用全局快捷键（D-08）', async () => {
    await execute('mode.switch-academic');
    expect(useWorkbenchStore.getState().mode).toBe('academic');
    expect(document.documentElement.dataset.mode).toBe('academic');
    const byId = new Map(getAll().map((c) => [c.id, c]));
    expect(byId.get('mode.switch-academic')?.title).toBe('模式：切换到 Academic（学术）');
    expect(byId.get('mode.switch-standard')?.shortcut).toBeUndefined();
    expect(byId.get('mode.switch-academic')?.shortcut).toBeUndefined();
    expect(byId.get('mode.switch-creative')?.shortcut).toBeUndefined();
  });

  it('execute theme.dark 后 documentElement data-theme=dark', async () => {
    await execute('theme.dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('execute view.toggle-sidebar 翻转当前模式 sidebarCollapsed', async () => {
    await execute('view.toggle-sidebar');
    expect(useWorkbenchStore.getState().layouts.standard.sidebarCollapsed).toBe(true);
    await execute('view.toggle-sidebar');
    expect(useWorkbenchStore.getState().layouts.standard.sidebarCollapsed).toBe(false);
  });

  it('合成 Ctrl+B / Ctrl+Alt+B 经 keymap 触发折叠', () => {
    initKeymap();
    window.dispatchEvent(key({ key: 'b', ctrlKey: true }));
    expect(useWorkbenchStore.getState().layouts.standard.sidebarCollapsed).toBe(true);
    window.dispatchEvent(key({ key: 'b', ctrlKey: true, altKey: true }));
    expect(useWorkbenchStore.getState().layouts.standard.rightPanelCollapsed).toBe(true);
  });

  it('合成 Ctrl+Shift+P 切换命令面板', () => {
    initKeymap();
    window.dispatchEvent(key({ key: 'P', ctrlKey: true, shiftKey: true }));
    expect(usePaletteStore.getState().open).toBe(true);
    expect(usePaletteStore.getState().query).toBe('>');
    window.dispatchEvent(key({ key: 'P', ctrlKey: true, shiftKey: true }));
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it('execute view.reset-layout 恢复 DEFAULT_LAYOUT', async () => {
    useWorkbenchStore.getState().setLayout({ sidebarWidth: 333, rightPanelCollapsed: true });
    await execute('view.reset-layout');
    expect(useWorkbenchStore.getState().layouts.standard).toEqual(DEFAULT_LAYOUT);
  });

  it('execute app.about 打开关于对话框状态', async () => {
    useAboutStore.setState(useAboutStore.getInitialState(), true);
    await execute('app.about');
    expect(useAboutStore.getState().open).toBe(true);
  });

  it('execute app.exit 经 ipc 收口调 close', async () => {
    const close = vi.spyOn(windowControls, 'close').mockResolvedValue(undefined);
    await execute('app.exit');
    expect(close).toHaveBeenCalledTimes(1);
    close.mockRestore();
  });
});
