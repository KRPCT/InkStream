import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../stores/useEditorStore';
import Toolbar from './Toolbar';

const toggleBold = vi.hoisted(() => vi.fn());
const toggleItalic = vi.hoisted(() => vi.fn());
const wrapUnderline = vi.hoisted(() => vi.fn());
const insertLink = vi.hoisted(() => vi.fn());
const getView = vi.hoisted(() => vi.fn(() => ({}) as unknown));

vi.mock('./commands', () => ({ toggleBold, toggleItalic, wrapUnderline, insertLink }));
vi.mock('../viewHandle', () => ({ getView }));

function setRichtext(on: boolean): void {
  useEditorStore.setState({ isRichtext: on });
}

describe('richtext Toolbar（D-14）', () => {
  beforeEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
    [toggleBold, toggleItalic, wrapUnderline, insertLink].forEach((m) => m.mockClear());
  });

  afterEach(() => {
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it('非 richtext 文件不渲染工具条', () => {
    setRichtext(false);
    const { container } = render(<Toolbar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('richtext 文件渲染 B/I/U/链接四钮', () => {
    setRichtext(true);
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: /加粗/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /斜体/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下划线/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /链接/ })).toBeInTheDocument();
  });

  it('点 B 调 toggleBold', async () => {
    setRichtext(true);
    render(<Toolbar />);
    await userEvent.click(screen.getByRole('button', { name: /加粗/ }));
    expect(toggleBold).toHaveBeenCalledTimes(1);
  });

  it('点链接调 insertLink', async () => {
    setRichtext(true);
    render(<Toolbar />);
    await userEvent.click(screen.getByRole('button', { name: /链接/ }));
    expect(insertLink).toHaveBeenCalledTimes(1);
  });

  it('按钮 tooltip 含 Ctrl+B/I/U/K 快捷键提示', () => {
    setRichtext(true);
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: /加粗/ }).getAttribute('title')).toContain('Ctrl+B');
    expect(screen.getByRole('button', { name: /斜体/ }).getAttribute('title')).toContain('Ctrl+I');
    expect(screen.getByRole('button', { name: /下划线/ }).getAttribute('title')).toContain(
      'Ctrl+U',
    );
    expect(screen.getByRole('button', { name: /链接/ }).getAttribute('title')).toContain('Ctrl+K');
  });
});
