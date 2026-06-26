import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 大纲面板回归门：useOutlineStore 驱动渲染，点击 → scrollToHeading(from)。 */

const scrollToHeading = vi.fn<(from: number) => void>();
const syncOutline = vi.fn();
// 部分 mock：仅桩化有副作用的 scrollToHeading/syncOutline，保留真实 activeHeadingFrom（活动项推导）。
vi.mock('../../editor/outline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../editor/outline')>()),
  scrollToHeading: (f: number) => scrollToHeading(f),
  syncOutline: () => syncOutline(),
}));
vi.mock('../../editor/viewHandle', () => ({ getView: () => null, revealRange: vi.fn() }));

const { default: OutlinePanel } = await import('./OutlinePanel');
const { useOutlineStore } = await import('../../stores/useOutlineStore');
const { useEditorStore } = await import('../../stores/useEditorStore');

beforeEach(() => {
  scrollToHeading.mockClear();
  useOutlineStore.setState({ items: [] });
  useEditorStore.setState({ activePath: 'a.md', cursor: 0 });
});

describe('OutlinePanel', () => {
  it('空大纲 → 空态文案', () => {
    render(<OutlinePanel />);
    expect(screen.getByText('暂无大纲')).toBeInTheDocument();
  });

  it('渲染标题列表', () => {
    useOutlineStore.setState({
      items: [
        { level: 1, text: '一级', from: 0 },
        { level: 2, text: '二级', from: 10 },
      ],
    });
    render(<OutlinePanel />);
    expect(screen.getByText('一级')).toBeInTheDocument();
    expect(screen.getByText('二级')).toBeInTheDocument();
  });

  it('点击标题行 → scrollToHeading(from)', () => {
    useOutlineStore.setState({ items: [{ level: 1, text: '一级', from: 42 }] });
    render(<OutlinePanel />);
    fireEvent.click(screen.getByText('一级'));
    expect(scrollToHeading).toHaveBeenCalledWith(42);
  });

  it('editor→outline：高亮光标所在标题（aria-current=location）', () => {
    useOutlineStore.setState({
      items: [
        { level: 1, text: '一级', from: 0 },
        { level: 2, text: '二级', from: 10 },
      ],
    });
    useEditorStore.setState({ cursor: 15 }); // 落在「二级」段内
    render(<OutlinePanel />);
    expect(screen.getByText('二级')).toHaveAttribute('aria-current', 'location');
    expect(screen.getByText('一级')).not.toHaveAttribute('aria-current');
  });

  it('光标移动改变高亮目标', () => {
    useOutlineStore.setState({
      items: [
        { level: 1, text: '一级', from: 0 },
        { level: 2, text: '二级', from: 10 },
      ],
    });
    useEditorStore.setState({ cursor: 5 }); // 落在「一级」段内
    render(<OutlinePanel />);
    expect(screen.getByText('一级')).toHaveAttribute('aria-current', 'location');
    expect(screen.getByText('二级')).not.toHaveAttribute('aria-current');
  });
});
