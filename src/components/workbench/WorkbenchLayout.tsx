import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import {
  Group,
  Panel,
  Separator,
  useGroupRef,
  usePanelRef,
  type PanelImperativeHandle,
} from 'react-resizable-panels';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { createLayoutWriteback } from './layoutPatch';
import GitGraphView from '../git/GitGraphView';
import MergeResolver from '../git/MergeResolver';
import ReadingView from '../reading/ReadingView';
import BookshelfView from '../bookshelf/BookshelfView';
import GraphView from './GraphView';
import ProjectSearchView from '../multibuffer/ProjectSearchView';
import CentralArea from './CentralArea';
import RightPanel from './RightPanel';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import TitleBar from './TitleBar';
import ProjectRail from '../projects/ProjectRail';
import ProjectArchive from '../projects/ProjectArchive';
import { isCompactWorkbench, useCompactWorkbench } from './useCompactWorkbench';
import { registerLayoutRestore } from './layoutRestore';
import './workbench.css';

/**
 * store 折叠态 → 面板命令式 collapse/expand（仅在不一致时调用，幂等）。
 */
function syncCollapsed(panel: PanelImperativeHandle | null, collapsed: boolean): boolean {
  if (!panel || panel.isCollapsed() === collapsed) return false;
  if (collapsed) panel.collapse();
  else panel.expand();
  return true;
}

/**
 * 模式切换时命令式应用该模式记忆几何（D-10）：折叠态 + 像素宽度，瞬时无动画。
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
  const wasCollapsed = panel.isCollapsed();
  if (wasCollapsed) panel.expand();
  if (Math.abs(panel.getSize().inPixels - width) <= .5) return wasCollapsed;
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
  const reducedMotion = useSettingsStore((s) => s.reducedMotion);
  const reducedTransparency = useSettingsStore((s) => s.reducedTransparency);
  const compact = useCompactWorkbench();
  const projectPhase = useProjectStore((s) => s.phase);
  const projectId = useProjectStore((s) => s.activeId);
  const archiveOpen = useProjectStore((s) => s.archiveOpen);
  const editingBlocked = projectPhase !== 'idle' || archiveOpen;
  // 简易模式：图谱 / Git Graph / 合并均为高级覆盖层——纵深防御在渲染层兜底，挡住编辑器内 Ctrl+G
  // 直连 toggleCentralView（绕过 registry.execute 门控）及任何残留 centralView 状态。
  const simpleMode = useSettingsStore((s) => s.simpleMode);
  // git-graph 全宽：开图谱时作覆盖层盖住三栏（Group 不卸载保编辑器/CM 状态），故不动面板折叠机制（避 UAT #6）。
  const gitGraphOpen = useWorkbenchStore((s) => s.centralView === 'gitGraph') && !simpleMode;
  const graphOpen = useWorkbenchStore((s) => s.centralView === 'graph') && !simpleMode;
  // 全库搜索 multibuffer 覆盖层（#2c）：依赖 FTS5 索引，简易模式隐藏（同知识图谱）。
  const projectSearchOpen = useWorkbenchStore((s) => s.centralView === 'multibuffer') && !simpleMode;
  const mergeOpen = useWorkbenchStore((s) => s.centralView === 'mergeResolve') && !simpleMode;
  // 阅读模式覆盖层（FEAT-READ）：基础功能，简易模式下也可用（不 !simpleMode 门控）。
  const readingOpen = useWorkbenchStore((s) => s.centralView === 'reading');
  // 书架覆盖层（FEAT-SHELF）：由 bookshelfEnabled 设置门控（与简易模式正交）。
  const bookshelfEnabled = useSettingsStore((s) => s.bookshelfEnabled);
  const bookshelfOpen = useWorkbenchStore((s) => s.centralView === 'bookshelf') && bookshelfEnabled;
  const groupRef = useGroupRef();
  const groupElement = useRef<HTMLDivElement>(null);
  const sidebarRef = usePanelRef();
  const rightRef = usePanelRef();
  // defaultSize 仅挂载时读取：捕获挂载时刻的当前模式几何
  const mountLayout = useRef(layout);
  const prevMode = useRef(mode);
  const previousProject = useRef(projectId);
  const previousPhase = useRef(projectPhase);
  const previousCompact = useRef(compact);
  const writeback = useRef(createLayoutWriteback(() => {
    const workbench = useWorkbenchStore.getState();
    const project = useProjectStore.getState();
    return {
      compact: isCompactWorkbench(),
      blocked: project.phase !== 'idle' || project.archiveOpen || !project.ready,
      projectId: project.activeId,
      mode: workbench.mode,
      layout: workbench.layouts[workbench.mode],
      viewportWidth: window.innerWidth,
    };
  }, (patch) => useWorkbenchStore.getState().setLayout(patch))).current;

  useEffect(() => {
    // The panel library handles pointer/double-click at document capture and
    // keyboard events at the separator. Capture at window before either path.
    const begin = (event: MouseEvent | KeyboardEvent) => {
      writeback.cancel();
      if (event.defaultPrevented || !(event.target instanceof Element)) return;
      const group = groupElement.current;
      if (!group || !group.contains(event.target)) return;
      if (event instanceof KeyboardEvent) {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key) || event.isComposing) return;
        if (!event.target.closest('.workbench-separator')) return;
      } else {
        if (event.button !== 0) return;
        // Keep the library's larger touch/mouse hit area around separators.
        const hitSize = 'pointerType' in event && event.pointerType === 'touch' ? 20 : 10;
        const hit = [...group.querySelectorAll<HTMLElement>('.workbench-separator')].some((separator) => {
          const rect = separator.getBoundingClientRect();
          return rect.height > 0 && event.clientY >= rect.top && event.clientY <= rect.bottom &&
            Math.abs(event.clientX - (rect.left + rect.width / 2)) <= Math.max(rect.width, hitSize) / 2;
        });
        if (!hit && !event.target.closest('.workbench-separator')) return;
      }
      writeback.begin();
    };
    const cancel = () => writeback.cancel();
    window.addEventListener('pointerdown', begin, true);
    window.addEventListener('dblclick', begin, true);
    window.addEventListener('keydown', begin, true);
    // onLayoutChanged runs at document capture on pointer release; retire the
    // gesture afterwards, including clicks/keys that produced no layout change.
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keyup', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    const unsubscribe = useProjectStore.subscribe((next, previous) => {
      if (next.phase !== previous.phase || next.activeId !== previous.activeId ||
        next.archiveOpen !== previous.archiveOpen || next.ready !== previous.ready) cancel();
    });
    return () => {
      unsubscribe();
      window.removeEventListener('pointerdown', begin, true);
      window.removeEventListener('dblclick', begin, true);
      window.removeEventListener('keydown', begin, true);
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keyup', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      cancel();
    };
  }, [writeback]);

  const restorePanels = useCallback(() => {
    writeback.cancel();
    if (isCompactWorkbench() || useProjectStore.getState().phase !== 'idle') return;
    const workbench = useWorkbenchStore.getState();
    const remembered = workbench.layouts[workbench.mode];
    applyPanelLayout(sidebarRef.current, remembered.sidebarCollapsed, remembered.sidebarWidth);
    applyPanelLayout(rightRef.current, remembered.rightPanelCollapsed, remembered.rightPanelWidth);
  }, [sidebarRef, rightRef, writeback]);

  // Panel measurements write layout back to the store. That write must never
  // trigger another resize: restore only at a semantic handover or explicit reset.
  useEffect(() => registerLayoutRestore(restorePanels), [restorePanels]);
  useEffect(() => {
    const changed = prevMode.current !== mode || previousProject.current !== projectId || previousCompact.current !== compact ||
      (previousPhase.current !== 'idle' && projectPhase === 'idle');
    prevMode.current = mode;
    previousProject.current = projectId;
    previousPhase.current = projectPhase;
    previousCompact.current = compact;
    if (changed && projectPhase === 'idle') restorePanels();
  }, [mode, projectId, projectPhase, compact, restorePanels]);

  useEffect(() => {
    writeback.cancel();
    if (!isCompactWorkbench() && useProjectStore.getState().phase === 'idle') syncCollapsed(sidebarRef.current, layout.sidebarCollapsed);
  }, [layout.sidebarCollapsed, sidebarRef, writeback]);

  useEffect(() => {
    writeback.cancel();
    if (!isCompactWorkbench() && useProjectStore.getState().phase === 'idle') syncCollapsed(rightRef.current, layout.rightPanelCollapsed);
  }, [layout.rightPanelCollapsed, rightRef, writeback]);

  // 窗口缩放后和解（修「小窗侧栏被挤折叠、放大后不恢复、需重复打开」）：窗口足够宽时，把 store 认为应展开
  // 却被库挤到 collapsedSize(0) 的面板重新展开。和解测量不回写记忆几何。
  // 真相源仍是 store 各自的 toggle；本和解仅修复 squeeze 引发的 store↔面板脱同步。
  useEffect(() => {
    let frame = 0;
    const reconcile = (): void => {
      writeback.cancel();
      cancelAnimationFrame(frame);
      // Let the Group's ResizeObserver accept the new geometry before applying pixel memory.
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { frame = 0; restorePanels(); }); });
    };
    window.addEventListener('resize', reconcile);
    return () => { window.removeEventListener('resize', reconcile); cancelAnimationFrame(frame); };
  }, [restorePanels, writeback]);

  // 拖拽结束采样（onLayoutChanged：指针释放后触发，d.ts 推荐的持久化时点）。
  // 回调本身不区分来源；仅接收仍属于当前项目、模式及窗口尺寸的用户调整。
  // writeback 在执行当时读取 matchMedia 和 project phase，不依赖上一拍 React closure。
  const handleLayoutChanged = useCallback(() => {
    writeback.commit(sidebarRef.current, rightRef.current);
  }, [sidebarRef, rightRef, writeback]);

  return (
    <div className="inkstream-shell flex h-screen flex-col" data-reduced-motion={reducedMotion} data-reduced-transparency={reducedTransparency}
      data-left-collapsed={layout.sidebarCollapsed} data-right-collapsed={layout.rightPanelCollapsed}
      style={{ '--navigation-width': `${layout.sidebarWidth}px`, '--tools-width': `${layout.rightPanelWidth}px` } as CSSProperties}>
      <TitleBar />
      <div className="workbench-stage relative min-h-0 flex-1">
      <ProjectRail />
      <div className="workbench-content" inert={editingBlocked} data-testid="workbench-content">
      <Group
        groupRef={groupRef}
        elementRef={groupElement}
        orientation="horizontal"
        onLayoutChanged={handleLayoutChanged}
        className="workbench-group h-full w-full"
      >
        <Panel
          id="sidebar"
          groupResizeBehavior="preserve-pixel-size"
          panelRef={sidebarRef}
          defaultSize={mountLayout.current.sidebarWidth}
          minSize={200}
          maxSize={480}
          collapsible
          collapsedSize={0}
          className="workbench-navigation-panel h-full"
        >
          <Sidebar />
        </Panel>
        <Separator className="workbench-separator navigation-separator" />
        <Panel id="editor-area" minSize={400} className="workbench-document-panel h-full">
          <CentralArea />
        </Panel>
        <Separator className="workbench-separator tools-separator" />
        <Panel
          id="right-panel"
          groupResizeBehavior="preserve-pixel-size"
          panelRef={rightRef}
          defaultSize={mountLayout.current.rightPanelWidth}
          minSize={240}
          maxSize={560}
          collapsible
          collapsedSize={0}
          className="workbench-tools-panel h-full"
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
        {projectSearchOpen ? (
          <div className="absolute inset-0 bg-[var(--background-primary)]">
            <ProjectSearchView />
          </div>
        ) : null}
        {mergeOpen ? (
          <div className="absolute inset-0 bg-[var(--background-primary)]">
            <MergeResolver />
          </div>
        ) : null}
        {readingOpen ? (
          <div className="absolute inset-0 bg-[var(--background-primary)]">
            <ReadingView />
          </div>
        ) : null}
        {bookshelfOpen ? (
          <div className="absolute inset-0 bg-[var(--background-primary)]">
            <BookshelfView />
          </div>
        ) : null}
      </div>
      {projectPhase !== 'idle' && !archiveOpen ? <div className="project-transition-notice" role="status">{projectPhase === 'saving' ? '保存当前文稿与会话…' : projectPhase === 'restoring' ? '恢复项目会话…' : '正在打开项目…'}</div> : null}
      </div>
      <StatusBar />
      <ProjectArchive />
    </div>
  );
}
