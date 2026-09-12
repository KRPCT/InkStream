import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBuiltinCommands } from '../../commands/builtins';
import { getAll } from '../../commands/registry';
import { gitClone } from '../../ipc/git';
import { useGitStore } from '../../stores/useGitStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useVaultStore } from '../../stores/useVaultStore';
import MenuBar from './MenuBar';

vi.mock('../../ipc/git', async (original) => ({
  ...await original<typeof import('../../ipc/git')>(), gitClone: vi.fn(),
}));

let dispose: () => void;
beforeEach(() => {
  useSettingsStore.setState({ simpleMode: false, gitRemoteMode: 'ssh' });
  useVaultStore.setState(useVaultStore.getInitialState(), true);
  useGitStore.setState(useGitStore.getInitialState(), true);
  vi.mocked(gitClone).mockReset();
  dispose = registerBuiltinCommands();
});
afterEach(() => { cleanup(); dispose(); });

describe('#34 应用内克隆的公开入口', () => {
  it('没有工作区或Git仓库时，文件菜单仍提供可用的克隆仓库入口', async () => {
    const user = userEvent.setup();
    render(<MenuBar />);
    await user.click(screen.getByRole('menuitem', { name: '文件' }));
    const clone = screen.getByRole('menuitem', { name: /克隆仓库/ });
    expect(clone).not.toBeDisabled();
    expect(clone).not.toHaveAttribute('aria-disabled', 'true');
    expect(gitClone).not.toHaveBeenCalled();
    expect(useVaultStore.getState().vault).toBeNull();
  });

  it('registry注册同一个克隆命令，进入填写流程前不触发网络克隆或改变工作区', () => {
    const clone = getAll().find((command) => command.id === 'git.clone');
    expect(clone).toBeDefined();
    expect(clone?.title).toMatch(/克隆仓库/);
    expect(clone?.advanced).toBe(true);
    expect(gitClone).not.toHaveBeenCalled();
    expect(useGitStore.getState().repoRoot).toBeNull();
    expect(useVaultStore.getState().vault).toBeNull();
  });
});
