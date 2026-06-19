import { toggleFocusMode } from '../editor/livepreview/focusMode';
import { toggleRenderMode } from '../editor/livepreview/renderMode';
import { toggleTypewriter } from '../editor/livepreview/typewriter';
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
];
