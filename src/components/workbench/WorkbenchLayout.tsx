import { useCallback, useEffect, useRef } from 'react';
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  usePanelRef,
  type PanelImperativeHandle,
} from 'react-resizable-panels';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import type { ModeLayout } from '../../types/workbench';
import EditorArea from './EditorArea';
import RightPanel from './RightPanel';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import TitleBar from './TitleBar';
import './workbench.css';

/** store 折叠态 → 面板命令式 collapse/expand（仅在不一致时调用，幂等）。 */
function syncCollapsed(panel: PanelImperativeHandle | null, collapsed: boolean): void {
  if (!panel || panel.isCollapsed() === collapsed) return;
  if (collapsed) panel.collapse();
  else panel.expand();
}

/** 模式切换时命令式应用该模式记忆几何（D-10）：折叠态 + 像素宽度，瞬时无动画。 */
function applyPanelLayout(
  panel: PanelImperativeHandle | null,
  collapsed: boolean,
  width: number,
): void {
  if (!panel) return;
  if (collapsed) {
    if (!panel.isCollapsed()) panel.collapse();
    return;
  }
  if (panel.isCollapsed()) panel.expand();
  panel.resize(width);
}

/**
 * 唯一布局容器（react-resizable-panels v4 像素布局）。
 * 五插槽 Shell 永不卸载；模式切换严禁 key={mode} 重建（Anti-Pattern），
 * 订阅 mode 经 panelRef 命令式应用各模式记忆布局（D-10，瞬时无动画）。
 * 几何契约（UI-SPEC）：Sidebar 280(200-480) / EditorArea min 400 / RightPanel 320(240-560)。
 */
export default function WorkbenchLayout() {
  const mode = useWorkbenchStore((s) => s.mode);
  const layout = useWorkbenchStore((s) => s.layouts[s.mode]);
  const setLayout = useWorkbenchStore((s) => s.setLayout);
  const groupRef = useGroupRef();
  const sidebarRef = usePanelRef();
  const rightRef = usePanelRef();
  // defaultSize 仅挂载时读取：捕获挂载时刻的当前模式几何
  const mountLayout = useRef(layout);
  const prevMode = useRef(mode);

  // 模式切换（D-10）：命令式恢复该模式记忆布局（宽度 + 折叠态），瞬时无动画。
  // 严禁 key={mode} 重建（Anti-Pattern）——五插槽与 EditorArea 全程零卸载。
  useEffect(() => {
    if (prevMode.current === mode) return;
    prevMode.current = mode;
    const remembered = useWorkbenchStore.getState().layouts[mode];
    applyPanelLayout(sidebarRef.current, remembered.sidebarCollapsed, remembered.sidebarWidth);
    applyPanelLayout(rightRef.current, remembered.rightPanelCollapsed, remembered.rightPanelWidth);
  }, [mode, sidebarRef, rightRef]);

  useEffect(() => {
    syncCollapsed(sidebarRef.current, layout.sidebarCollapsed);
  }, [layout.sidebarCollapsed, sidebarRef]);

  useEffect(() => {
    syncCollapsed(rightRef.current, layout.rightPanelCollapsed);
  }, [layout.rightPanelCollapsed, rightRef]);

  // 拖拽结束采样（onLayoutChanged：指针释放后触发，d.ts 推荐的持久化时点）
  // 像素宽度经 panelRef.getSize().inPixels 读取（Layout 回调本体是百分比映射）
  const handleLayoutChanged = useCallback(() => {
    const patch: Partial<ModeLayout> = {};
    const sidebar = sidebarRef.current;
    if (sidebar) {
      patch.sidebarCollapsed = sidebar.isCollapsed();
      if (!sidebar.isCollapsed()) {
        patch.sidebarWidth = Math.round(sidebar.getSize().inPixels);
      }
    }
    const right = rightRef.current;
    if (right) {
      patch.rightPanelCollapsed = right.isCollapsed();
      if (!right.isCollapsed()) {
        patch.rightPanelWidth = Math.round(right.getSize().inPixels);
      }
    }
    setLayout(patch);
  }, [setLayout, sidebarRef, rightRef]);

  return (
    <div className="flex h-screen flex-col bg-[var(--background-primary)]">
      <TitleBar />
      <Group
        groupRef={groupRef}
        orientation="horizontal"
        onLayoutChanged={handleLayoutChanged}
        className="min-h-0 flex-1"
      >
        <Panel
          id="sidebar"
          panelRef={sidebarRef}
          defaultSize={mountLayout.current.sidebarWidth}
          minSize={200}
          maxSize={480}
          collapsible
          collapsedSize={0}
          className="h-full"
        >
          <Sidebar />
        </Panel>
        <Separator className="workbench-separator" />
        <Panel id="editor-area" minSize={400} className="h-full">
          <EditorArea />
        </Panel>
        <Separator className="workbench-separator" />
        <Panel
          id="right-panel"
          panelRef={rightRef}
          defaultSize={mountLayout.current.rightPanelWidth}
          minSize={240}
          maxSize={560}
          collapsible
          collapsedSize={0}
          className="h-full"
        >
          <RightPanel />
        </Panel>
      </Group>
      <StatusBar />
    </div>
  );
}
