import {
  collapseAllInTree,
  newFileInTree,
  newFolderInTree,
  renameNodeInTree,
} from '../components/workbench/fileTreeController';
import { createFileTreeOps } from '../components/workbench/fileTreeOps';
import { newDraftDocument } from '../editor/draftFlow';
import { requestOpenFile, requestOpenFolder, requestOpenRecent } from '../editor/vaultFlow';
import { cycleDocumentLanguage } from '../editor/richtext/switchLanguage';
import { flushActiveFile } from '../editor/saveFlow';
import { windowControls } from '../ipc/window';
import { useAboutStore } from '../stores/useAboutStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useHelpStore } from '../stores/useHelpStore';
import { useOnboardingStore } from '../stores/useOnboardingStore';
import { usePaletteStore } from '../stores/usePaletteStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import { showToast } from '../stores/useToastStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { Command } from '../types/commands';

/**
 * 核心命令定义（主题/视图/模式/文件/文档/应用/帮助）。
 * 从 builtins 析出避免单文件超 200 行（编辑/段落/格式见 textCommands）。
 * 标题字面照 UI-SPEC / R4 §1.3；菜单与面板均从 registry.getAll() 取 title/shortcut（D-02 同源）。
 * 模式命令不占用全局快捷键（D-08）。键位裁决见 R4 §3（侧栏 Ctrl+\、加粗 Ctrl+B、打开文件 Ctrl+O）。
 */

/** 当前活动文件 → TreeNode（命令面板 rename/delete 的目标）；无活动文件 no-op。 */
function activeNode(): { id: string; name: string; isDir: false } | null {
  const { activePath, tabs } = useEditorStore.getState();
  if (!activePath) return null;
  const tab = tabs.find((t) => t.path === activePath);
  return { id: activePath, name: tab?.name ?? activePath, isDir: false };
}

/** 有 vault 才执行 action，否则提示先打开文件夹（新建文件/文件夹的前置守卫）。 */
function requireVault(action: () => void): void {
  if (useVaultStore.getState().vault === null) {
    showToast('warning', '请先打开一个文件夹作为工作区，再新建文件。');
    return;
  }
  action();
}

export const CORE_COMMANDS: Command[] = [
  { id: 'theme.light', title: '主题：亮色', run: () => useSettingsStore.getState().setTheme('light') },
  { id: 'theme.dark', title: '主题：暗色', run: () => useSettingsStore.getState().setTheme('dark') },
  {
    id: 'theme.system',
    title: '主题：跟随系统',
    run: () => useSettingsStore.getState().setTheme('system'),
  },
  {
    id: 'view.toggle-sidebar',
    title: '视图：切换侧边栏',
    // R4 §3：侧栏让位 Ctrl+B（加粗），改 Ctrl+\（UAT 待用户确认）。
    shortcut: 'Ctrl+\\',
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
    id: 'view.settings',
    title: '视图：设置',
    shortcut: 'Ctrl+,',
    run: () => useSettingsUiStore.getState().openSettings(),
  },
  {
    id: 'mode.switch-standard',
    title: '模式：切换到 Standard（通用）',
    advanced: true,
    run: () => useWorkbenchStore.getState().setMode('standard'),
  },
  {
    id: 'mode.switch-academic',
    title: '模式：切换到 Academic（学术）',
    advanced: true,
    run: () => useWorkbenchStore.getState().setMode('academic'),
  },
  {
    id: 'mode.switch-creative',
    title: '模式：切换到 Creative（长篇创作）',
    advanced: true,
    run: () => useWorkbenchStore.getState().setMode('creative'),
  },
  {
    id: 'file.open-file',
    title: '文件：打开文件',
    shortcut: 'Ctrl+O',
    // R4 §2：原生文件对话框；vault 内直接打开，vault 外切到其父目录后打开。
    run: () => void requestOpenFile(),
  },
  {
    id: 'file.open-folder',
    title: '文件：打开文件夹',
    // R4 §3：让位 Ctrl+O 给「打开文件」，改 Ctrl+Shift+O（原生目录对话框，R4 §2）。
    shortcut: 'Ctrl+Shift+O',
    run: () => void requestOpenFolder(),
  },
  { id: 'file.open-recent', title: '文件：打开最近', run: () => void requestOpenRecent() },
  {
    id: 'file.new-document',
    title: '文件：新建文档',
    shortcut: 'Ctrl+N',
    // 无论有无 vault：开一个未命名草稿（纯内存，Ctrl+S 另存为转正）——打开 app 即可写。
    run: () => newDraftDocument(),
  },
  {
    id: 'file.new-file',
    title: '文件：新建文件',
    // Ctrl+N 让位「新建文档」（用户直觉：新建即写）；树内建文件改 Ctrl+Alt+N。
    shortcut: 'Ctrl+Alt+N',
    // 无 vault 先提示打开文件夹（在当前 vault 根创建，复用 fileTreeOps 不绕 path_guard）。
    run: () => requireVault(() => newFileInTree()),
  },
  {
    id: 'file.new-folder',
    title: '文件：新建文件夹',
    run: () => requireVault(() => newFolderInTree()),
  },
  { id: 'file.save', title: '文件：保存', shortcut: 'Ctrl+S', run: () => void flushActiveFile() },
  {
    id: 'file.rename',
    title: '文件：在文件树中重命名',
    run: () => {
      const node = activeNode();
      if (node) renameNodeInTree(node.id);
    },
  },
  {
    id: 'file.delete',
    title: '文件：删除到回收站',
    run: () => {
      const node = activeNode();
      if (node) void createFileTreeOps().remove(node);
    },
  },
  { id: 'view.collapse-tree', title: '视图：折叠文件树', run: () => collapseAllInTree() },
  {
    id: 'go.quick-open',
    title: '转到：快速打开文件',
    shortcut: 'Ctrl+P',
    run: () => usePaletteStore.getState().openQuickOpen(),
  },
  {
    id: 'doc.toggle-language',
    title: '文档：切换文档语言',
    // 写入/修改 frontmatter `language` 字段，循环 markdown→latex→typst→richtext（D-13）。
    advanced: true,
    run: () => cycleDocumentLanguage(),
  },
  { id: 'app.exit', title: '应用：退出', run: () => void windowControls.close() },
  {
    id: 'app.about',
    title: '帮助：关于 InkStream',
    run: () => useAboutStore.getState().openAbout(),
  },
  {
    id: 'help.guide',
    title: '帮助：使用教程',
    // 图文教学：提交/回滚/分支/合并/多设备同步（簇③）。
    run: () => useHelpStore.getState().openHelp(),
  },
  {
    id: 'help.onboarding',
    title: '帮助：重新引导',
    run: () => useOnboardingStore.getState().start(),
  },
  {
    id: 'help.shortcuts',
    title: '帮助：快捷键参考',
    // 弹命令面板命令模式（预填 '>'，每行右侧显示 Kbd 快捷键芯片，即快捷键参考视图）。
    run: () => usePaletteStore.getState().openPalette(),
  },
];
