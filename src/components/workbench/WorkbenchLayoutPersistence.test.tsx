import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../../stores/useProjectStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import { DEFAULT_LAYOUT } from '../../types/workbench';
import { restoreWorkbenchLayout } from './layoutRestore';
import WorkbenchLayout from './WorkbenchLayout';

const measurements = vi.hoisted(() => ({
  compact: false, sidebar: 280, right: 320,
  changed: null as (() => void) | null,
}));

// jsdom has no panel geometry. Supply measured panel handles while keeping the
// workbench's real DOM input listeners, project store, reset action and save path.
vi.mock('react-resizable-panels', async () => {
  const React = await import('react');
  type GroupProps = { children: React.ReactNode; elementRef: React.Ref<HTMLDivElement>; onLayoutChanged: () => void };
  type PanelProps = { id: string; children: React.ReactNode; panelRef?: React.RefObject<unknown> };
  return {
    useGroupRef: () => React.useRef(null),
    usePanelRef: () => React.useRef(null),
    Group: ({ children, elementRef, onLayoutChanged }: GroupProps) => {
      measurements.changed = onLayoutChanged;
      return <div ref={elementRef}>{children}</div>;
    },
    Panel: ({ id, children, panelRef }: PanelProps) => {
      React.useLayoutEffect(() => {
        if (!panelRef) return;
        const key = id === 'sidebar' ? 'sidebar' : 'right';
        const resize = (width: number) => { measurements[key] = width; measurements.changed?.(); };
        panelRef.current = {
          isCollapsed: () => measurements[key] === 0,
          getSize: () => ({ inPixels: measurements[key], asPercentage: 0 }),
          resize, collapse: () => resize(0), expand: () => resize(key === 'sidebar' ? 280 : 320),
        };
        return () => { panelRef.current = null; };
      }, [id, panelRef]);
      return <div>{children}</div>;
    },
    Separator: ({ className }: { className: string }) => <div role="separator" tabIndex={0} className={className} />,
  };
});
vi.mock('./TitleBar', () => ({ default: () => null }));
vi.mock('./Sidebar', () => ({ default: () => null }));
vi.mock('./RightPanel', () => ({ default: () => null }));
vi.mock('./CentralArea', () => ({ default: () => null }));
vi.mock('./StatusBar', () => ({ default: () => null }));
vi.mock('../projects/ProjectRail', () => ({ default: () => null }));
vi.mock('../projects/ProjectArchive', () => ({ default: () => null }));

beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useProjectStore.setState({ ready: true, phase: 'idle', archiveOpen: false, activeId: 'first' });
  measurements.compact = false;
  measurements.sidebar = 280;
  measurements.right = 320;
  measurements.changed = null;
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    media: query, onchange: null,
    get matches() { return query.includes('max-width: 1100px') && measurements.compact; },
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(() => true),
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const currentLayout = () => useWorkbenchStore.getState().layouts.standard;
function startDrag(separator: HTMLElement) {
  // jsdom does not provide PointerEvent; a mouse-backed pointer event retains
  // the browser's button/target/bubbling semantics used by the input listener.
  fireEvent(separator, new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
}
function measure(sidebar: number, right: number) {
  measurements.sidebar = sidebar;
  measurements.right = right;
  measurements.changed?.();
}

describe('workbench saves user sizing without saving transient geometry', () => {
  it('does not replace the session with startup or programmatic measurements', () => {
    render(<WorkbenchLayout />);
    act(() => { measure(0, 560); measure(280, 560); });
    expect(currentLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('persists a real separator drag and its independent collapsed state', () => {
    render(<WorkbenchLayout />);
    const separator = screen.getAllByRole('separator')[0];
    startDrag(separator);
    act(() => measure(300, 340));
    fireEvent.pointerUp(window);
    expect(currentLayout()).toEqual({ sidebarWidth: 300, rightPanelWidth: 340, sidebarCollapsed: false, rightPanelCollapsed: false });
    startDrag(separator);
    act(() => measure(0, 340));
    fireEvent.pointerUp(window);
    expect(currentLayout()).toEqual({ sidebarWidth: 300, rightPanelWidth: 340, sidebarCollapsed: true, rightPanelCollapsed: false });
  });

  it('persists keyboard sizing and double-click sizing through the same entry', () => {
    render(<WorkbenchLayout />);
    const separator = screen.getAllByRole('separator')[0];
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    act(() => measure(300, 320));
    fireEvent.keyUp(separator, { key: 'ArrowRight' });
    expect(currentLayout().sidebarWidth).toBe(300);
    fireEvent.doubleClick(separator, { button: 0 });
    act(() => measure(320, 320));
    expect(currentLayout().sidebarWidth).toBe(320);
  });

  it('reads compact matchMedia during the callback before the hook receives a change event', () => {
    render(<WorkbenchLayout />);
    startDrag(screen.getAllByRole('separator')[0]);
    measurements.compact = true;
    act(() => measure(0, 560));
    expect(currentLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('retires a gesture on a project handover even if the original project immediately returns', () => {
    render(<WorkbenchLayout />);
    startDrag(screen.getAllByRole('separator')[0]);
    act(() => {
      useProjectStore.setState({ phase: 'restoring' });
      measure(0, 560);
      useProjectStore.setState({ phase: 'idle' });
      measure(280, 560);
    });
    expect(currentLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps explicit reset defaults through intermediate resizes and accepts the next drag', () => {
    useWorkbenchStore.getState().setLayout({ sidebarWidth: 350, rightPanelWidth: 500 });
    render(<WorkbenchLayout />);
    startDrag(screen.getAllByRole('separator')[0]);
    act(() => {
      useWorkbenchStore.getState().resetCurrentLayout();
      restoreWorkbenchLayout();
      measure(280, 560);
    });
    expect(currentLayout()).toEqual(DEFAULT_LAYOUT);
    startDrag(screen.getAllByRole('separator')[0]);
    act(() => measure(300, 340));
    fireEvent.pointerUp(window);
    expect(currentLayout().sidebarWidth).toBe(300);
    expect(currentLayout().rightPanelWidth).toBe(340);
  });
});
