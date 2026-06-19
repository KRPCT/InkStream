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
import { buildLayoutPatch } from './layoutPatch';
import GitGraphView from '../git/GitGraphView';
import MergeResolver from '../git/MergeResolver';
import GraphView from './GraphView';
import CentralArea from './CentralArea';
import RightPanel from './RightPanel';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import TitleBar from './TitleBar';
import './workbench.css';

/**
 * store 折叠态 → 面板命令式 collapse/expand（仅在不一致时调用，幂等）。
 * 返回是否真正执行了命令式操作 —— 调用方据此为「将异步到来的 onLayoutChanged」记一次 suppress。
 */
function syncCollapsed(panel: PanelImperativeHandle | null, collapsed: boolean): boolean {
  if (!panel || panel.isCollapsed() === collapsed) return false;
  if (collapsed) panel.collapse();
  else panel.expand();
  return true;
}

/**
 * 模式切换时命令式应用该模式记忆几何（D-10）：折叠态 + 像素宽度，瞬时无动画。
 * 返回是否真正执行了命令式操作（折叠切换或 resize）—— 用于精确记 suppress，避免计数泄漏。
 */
function applyPanelLayout(
  panel: PanelImperativeHandle | null,
  collapsed: boolean,
  width: number,
): boolean {
  if (!panel) return false;
  if (collapsed) {
    if (panel.isCollapsed()) return false;
    panel.collapse();
    return true;
  }
  if (panel.isCollapsed()) panel.expand();
  panel.resize(width);
  return true;
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
  // git-graph 全宽：开图谱时作覆盖层盖住三栏（Group 不卸载保编辑器/CM 状态），故不动面板折叠机制（避 UAT #6）。
  const gitGraphOpen = useWorkbenchStore((s) => s.centralView === 'gitGraph');
  const graphOpen = useWorkbenchStore((s) => s.centralView === 'graph');
  const mergeOpen = useWorkbenchStore((s) => s.centralView === 'mergeResolve');
  const groupRef = useGroupRef();
  const sidebarRef = usePanelRef();
  const rightRef = usePanelRef();
  // defaultSize 仅挂载时读取：捕获挂载时刻的当前模式几何
  const mountLayout = useRef(layout);
  const prevMode = useRef(mode);
  // 命令式 collapse/expand/resize 会异步触发一次 onLayoutChanged（晚于操作落地，库的测量订阅驱动），
  // 故同步 set→op→clear 守卫是 no-op。改用计数器：每次命令式操作 +1，由下一次 onLayoutChanged 消费 -1。
  // 被消费的那拍只采样宽度、绝不回写任一面板的 collapsed —— 否则展开一侧把对侧瞬时挤到 collapsedSize
  // 会被误读为「折叠」并写回 store，造成两侧互斥（UAT #6）。折叠态真相源是 store 各自的 toggle。
  const suppressCollapsedWrites = useRef(0);

  // 模式切换（D-10）：命令式恢复该模式记忆布局（宽度 + 折叠态），瞬时无动画。
  // 严禁 key={mode} 重建（Anti-Pattern）——五插槽与 EditorArea 全程零卸载。
  useEffect(() => {
    if (prevMode.current === mode) return;
    prevMode.current = mode;
    const remembered = useWorkbenchStore.getState().layouts[mode];
    // 仅为真正执行了的命令式操作记 suppress，避免「目标几何已满足」时计数泄漏。
    if (applyPanelLayout(sidebarRef.current, remembered.sidebarCollapsed, remembered.sidebarWidth)) {
      suppressCollapsedWrites.current += 1;
    }
    if (applyPanelLayout(rightRef.current, remembered.rightPanelCollapsed, remembered.rightPanelWidth)) {
      suppressCollapsedWrites.current += 1;
    }
  }, [mode, sidebarRef, rightRef]);

  useEffect(() => {
    if (syncCollapsed(sidebarRef.current, layout.sidebarCollapsed)) {
      suppressCollapsedWrites.current += 1;
    }
  }, [layout.sidebarCollapsed, sidebarRef]);

  useEffect(() => {
    if (syncCollapsed(rightRef.current, layout.rightPanelCollapsed)) {
      suppressCollapsedWrites.current += 1;
    }
  }, [layout.rightPanelCollapsed, rightRef]);

  // 窗口缩放后和解（修「小窗侧栏被挤折叠、放大后不恢复、需重复打开」）：窗口足够宽时，把 store 认为应展开
  // 却被库挤到 collapsedSize(0) 的面板重新展开。命令式 expand 记 suppress，避免那拍误判对侧折叠（UAT #6 纪律）。
  // 真相源仍是 store 各自的 toggle；本和解仅修复 squeeze 引发的 store↔面板脱同步。
  useEffect(() => {
    const RECONCILE_MIN_WIDTH = 870; // 三栏 minSize 合计≈854，宽于此才有空间展开侧栏
    const reconcile = (): void => {
      if (window.innerWidth < RECONCILE_MIN_WIDTH) return;
      const l = useWorkbenchStore.getState().layouts[useWorkbenchStore.getState().mode];
      const sb = sidebarRef.current;
      if (sb && !l.sidebarCollapsed && sb.isCollapsed()) {
        sb.expand();
        suppressCollapsedWrites.current += 1;
      }
      const rp = rightRef.current;
      if (rp && !l.rightPanelCollapsed && rp.isCollapsed()) {
        rp.expand();
        suppressCollapsedWrites.current += 1;
      }
    };
    window.addEventListener('resize', reconcile);
    return () => window.removeEventListener('resize', reconcile);
  }, [sidebarRef, rightRef]);

  // 拖拽结束采样（onLayoutChanged：指针释放后触发，d.ts 推荐的持久化时点）。
  // 回调对命令式操作与用户拖拽一视同仁地触发、签名不区分来源；因此命令式触发的那拍
  // 只采样宽度（展开侧真实像素），绝不回写 collapsed flag。仅当 suppress 归零（真正的用户拖拽）
  // 才允许从布局派生 collapsed —— 此时两侧各写各的，互不串扰。
  const handleLayoutChanged = useCallback(() => {
    const suppressed = suppressCollapsedWrites.current > 0;
    if (suppressed) suppressCollapsedWrites.current -= 1;
    setLayout(buildLayoutPatch(sidebarRef.current, rightRef.current, suppressed));
  }, [setLayout, sidebarRef, rightRef]);

  return (
    <div className="flex h-screen flex-col bg-[var(--background-primary)]">
      <TitleBar />
      <div className="relative min-h-0 flex-1">
      <Group
        groupRef={groupRef}
        orientation="horizontal"
        onLayoutChanged={handleLayoutChanged}
        className="h-full w-full"
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
          <CentralArea />
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
        {gitGraphOpen ? (
          <div className="absolute inset-0 bg-[var(--background-primary)]">
            <GitGraphView />
          </div>
        ) : null}
        {graphOpen ? (
          <div className="absolute inset-0 bg-[var(--background-primary)]">
            <GraphView />
          </div>
        ) : null}
        {mergeOpen ? (
          <div className="absolute inset-0 bg-[var(--background-primary)]">
            <MergeResolver />
          </div>
        ) : null}
      </div>
      <StatusBar />
    </div>
  );
}
