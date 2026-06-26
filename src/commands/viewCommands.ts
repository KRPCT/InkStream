import { toggleFocusMode } from '../editor/livepreview/focusMode';
import { toggleRenderMode } from '../editor/livepreview/renderMode';
import { toggleTypewriter } from '../editor/livepreview/typewriter';
import { openActiveInReading, readingFormatOf } from '../editor/reading/openReading';
import { useEditorStore } from '../stores/useEditorStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { showToast } from '../stores/useToastStore';
import { useWritingMetricsStore } from '../stores/useWritingMetricsStore';
import { useWorkbenchStore } from '../stores/useWorkbenchStore';
import type { Command } from '../types/commands';

/**
 * 视图层命令：渲染模式 / 知识图谱 / 写作辅助（打字机·专注·写作 HUD）。
 * 从 coreCommands 析出避免单文件超 200 行（同 textCommands 拆分先例），均经 registry.getAll() 同源消费（D-02）。
 * 写作辅助（打字机 / 专注 / HUD）非 advanced——任何模式（含简易模式）可用；知识图谱依赖索引，advanced。
 */
export const VIEW_COMMANDS: Command[] = [
  {
    id: 'view.open-graph',
    title: '视图：知识图谱',
    // 全库 Graph View 中央区覆盖层（LINK-06）；再按回编辑器。
    shortcut: 'Ctrl+G',
    advanced: true,
    run: () => useWorkbenchStore.getState().toggleCentralView('graph'),
  },
  {
    id: 'view.project-search',
    title: '视图：全库搜索替换',
    // 全库搜索 multibuffer 中央区覆盖层（#2c）；再按回编辑器。依赖 FTS5 索引，简易模式隐藏（同知识图谱）。
    shortcut: 'Ctrl+Shift+F',
    advanced: true,
    run: () => useWorkbenchStore.getState().toggleCentralView('multibuffer'),
  },
  {
    id: 'view.toggle-terminal',
    title: '视图：内置终端',
    // 底部终端 dock 开关（#3）。依赖设置中启用；未启用时提示去开启。advanced：简易模式隐藏。
    shortcut: 'Ctrl+`',
    advanced: true,
    run: () => {
      if (!useSettingsStore.getState().terminalEnabled) {
        showToast('warning', '内置终端未启用：在「设置 ▸ 通用 ▸ 内置终端」中开启。');
        return;
      }
      useWorkbenchStore.getState().toggleTerminal();
    },
  },
  {
    id: 'view.toggle-render-mode',
    title: '视图：切换渲染模式',
    shortcut: 'Ctrl+E',
    // Source ↔ Live Preview 热切（Compartment.reconfigure）；非 markdown 文档静默 no-op（D-01）。
    run: () => void toggleRenderMode(),
  },
  {
    // 写作模式升级：光标行居中。写作辅助，非 advanced——任何模式（含简易模式）可用。
    id: 'view.toggle-typewriter',
    title: '视图：打字机模式',
    run: () => toggleTypewriter(),
  },
  {
    // 专注模式（CREA-03 已实现，原仅 F11）——补一条命令入口供命令面板 / HUD 调用。
    id: 'view.toggle-focus',
    title: '视图：专注模式',
    run: () => toggleFocusMode(),
  },
  {
    id: 'writing.toggle-hud',
    title: '写作：写作 HUD（码字速度 / 时间 / 番茄钟）',
    run: () => useWritingMetricsStore.getState().toggleVisible(),
  },
  {
    // 阅读模式：把当前文件在沉浸阅读覆盖层打开（docx/epub/pdf 打开时已自动进，此命令主要用于 txt）。
    id: 'view.open-reading',
    title: '视图：阅读模式',
    run: () => {
      const { activePath, tabs } = useEditorStore.getState();
      if (!activePath || readingFormatOf(activePath) === null) {
        showToast('warning', '当前文件不支持阅读模式（支持 txt / docx / epub / pdf）。');
        return;
      }
      openActiveInReading(activePath, tabs.find((t) => t.path === activePath)?.name ?? activePath);
    },
  },
];
