import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** 面包屑栏（#2b）：cursor + 大纲 → 标题路径；点击段跳转；无路径自隐。scrollToHeading 桩、activeHeadingPath 用真实。 */

const scrollToHeading = vi.hoisted(() => vi.fn());
vi.mock('../../editor/outline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../editor/outline')>()),
  scrollToHeading,
}));

const { default: Breadcrumbs } = await import('./Breadcrumbs');
const { useOutlineStore } = await import('../../stores/useOutlineStore');
const { useEditorStore } = await import('../../stores/useEditorStore');

const ITEMS = [
  { level: 1, text: '引言', from: 0 },
  { level: 2, text: '方法', from: 10 },
  { level: 3, text: '数据', from: 20 },
];

beforeEach(() => {
  scrollToHeading.mockClear();
  useOutlineStore.setState({ items: ITEMS });
  useEditorStore.setState({ activePath: 'a.md', cursor: 25 });
});

describe('Breadcrumbs', () => {
  it('显示光标所在标题路径（H1 › H2 › H3）', () => {
    render(<Breadcrumbs />);
    expect(screen.getByLabelText('标题路径')).toBeInTheDocument();
    expect(screen.getByText('引言')).toBeInTheDocument();
    expect(screen.getByText('方法')).toBeInTheDocument();
    expect(screen.getByText('数据')).toBeInTheDocument();
  });

  it('末段（最深标题）标 aria-current=location', () => {
    render(<Breadcrumbs />);
    expect(screen.getByText('数据')).toHaveAttribute('aria-current', 'location');
    expect(screen.getByText('引言')).not.toHaveAttribute('aria-current');
  });

  it('点击某段 → scrollToHeading(其 from)', () => {
    render(<Breadcrumbs />);
    fireEvent.click(screen.getByText('方法'));
    expect(scrollToHeading).toHaveBeenCalledWith(10);
  });

  it('光标在首个标题之前 → 整条自隐', () => {
    useEditorStore.setState({ cursor: 0 });
    useOutlineStore.setState({ items: [{ level: 1, text: '引言', from: 5 }] });
    render(<Breadcrumbs />);
    expect(screen.queryByLabelText('标题路径')).not.toBeInTheDocument();
  });

  it('无活动文档 → 自隐', () => {
    useEditorStore.setState({ activePath: null });
    render(<Breadcrumbs />);
    expect(screen.queryByLabelText('标题路径')).not.toBeInTheDocument();
  });
});
