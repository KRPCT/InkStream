import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import EditorArea from './EditorArea';

// 隔离重依赖：useCodeMirror（真实会 mount CM6）、richtext 工具条、外部变更条、子菜单壳。
vi.mock('../../editor/useCodeMirror', () => ({ useCodeMirror: vi.fn() }));
vi.mock('../../editor/richtext/Toolbar', () => ({ default: () => null }));
vi.mock('./ExternalChangeBar', () => ({ default: () => null }));
vi.mock('./EditorTabs', () => ({ default: () => null }));
vi.mock('../../editor/vaultFlow', () => ({ requestOpenFolder: vi.fn() }));

const getView = vi.fn();
vi.mock('../../editor/viewHandle', () => ({ getView: () => getView() }));

const isComposing = vi.fn();
vi.mock('../../editor/composition', () => ({ isComposing: (v: EditorView) => isComposing(v) }));

// 右键菜单壳：只断言是否被渲染（contextmenu 是否开菜单）。
vi.mock('./EditorContextMenu', () => ({
  default: () => <div data-testid="editor-context-menu" />,
}));

const fakeView = {} as EditorView;

function cmMount(): HTMLElement {
  return screen.getByTestId('cm-mount');
}

describe('EditorArea 右键菜单（R4 §4.3 组合期防御）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVaultStore.setState({ vault: { root: '/v', repoRoot: null, name: 'v' } });
    useEditorStore.setState({ tabs: [{ path: 'a.md', name: 'a.md' }], activePath: 'a.md' });
    getView.mockReturnValue(fakeView);
    isComposing.mockReturnValue(false);
  });

  afterEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState(), true);
    useEditorStore.setState(useEditorStore.getInitialState(), true);
  });

  it('非组合期 + 有活动文件：右键 preventDefault 并开自绘菜单', () => {
    render(<EditorArea />);
    const evt = fireEvent.contextMenu(cmMount(), { clientX: 30, clientY: 40 });
    expect(evt).toBe(false); // preventDefault 生效（fireEvent 返回 false 表示被取消）
    expect(screen.getByTestId('editor-context-menu')).toBeInTheDocument();
  });

  it('组合期（isComposing=true）：不开菜单、放行浏览器默认（铁律：组合期不 dispatch）', () => {
    isComposing.mockReturnValue(true);
    render(<EditorArea />);
    const evt = fireEvent.contextMenu(cmMount(), { clientX: 30, clientY: 40 });
    expect(evt).toBe(true); // 未 preventDefault
    expect(screen.queryByTestId('editor-context-menu')).not.toBeInTheDocument();
  });

  it('无活动文件：右键不开菜单（无可操作文档）', () => {
    useEditorStore.setState({ activePath: null });
    render(<EditorArea />);
    fireEvent.contextMenu(cmMount(), { clientX: 10, clientY: 10 });
    expect(screen.queryByTestId('editor-context-menu')).not.toBeInTheDocument();
  });
});
