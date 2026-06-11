import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitGuidanceStore } from '../../stores/useGitGuidanceStore';
import GitGuidanceBar from './GitGuidanceBar';

// vaultFlow 触达 Tauri（switchVault），组件仅引用其符号，测试 mock 掉避免桥层副作用。
vi.mock('../../editor/vaultFlow', () => ({
  switchVault: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  useGitGuidanceStore.setState({ guidance: { kind: 'none' } });
});

afterEach(() => {
  useGitGuidanceStore.setState({ guidance: { kind: 'none' } });
});

describe('GitGuidanceBar 窄宽下按钮不竖排（UAT #3）', () => {
  it('kind=none 不渲染', () => {
    const { container } = render(<GitGuidanceBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it('init 分支：两按钮均 whitespace-nowrap，描述文本 truncate', () => {
    useGitGuidanceStore.setState({ guidance: { kind: 'init', vaultRoot: '/v' } });
    render(<GitGuidanceBar />);

    const initBtn = screen.getByRole('button', { name: '初始化 git' });
    const dismissBtn = screen.getByRole('button', { name: '以后再说' });
    expect(initBtn).toHaveClass('whitespace-nowrap', 'shrink-0');
    expect(dismissBtn).toHaveClass('whitespace-nowrap', 'shrink-0');

    const text = screen.getByText('这个文件夹还不是 git 仓库，版本管理功能将在后续版本启用。');
    expect(text).toHaveClass('truncate', 'min-w-0', 'flex-1');
  });

  it('subdir 分支：两按钮均 whitespace-nowrap，描述文本 truncate', () => {
    useGitGuidanceStore.setState({
      guidance: { kind: 'subdir', vaultRoot: '/v/sub', repoRoot: '/v' },
    });
    render(<GitGuidanceBar />);

    const rootBtn = screen.getByRole('button', { name: '打开仓库根' });
    const onlyBtn = screen.getByRole('button', { name: '仅此文件夹' });
    expect(rootBtn).toHaveClass('whitespace-nowrap', 'shrink-0');
    expect(onlyBtn).toHaveClass('whitespace-nowrap', 'shrink-0');

    const text = screen.getByText('这个文件夹在一个 git 仓库内，你想打开仓库根还是仅此文件夹？');
    expect(text).toHaveClass('truncate', 'min-w-0', 'flex-1');
  });
});
