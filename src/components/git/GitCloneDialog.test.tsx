import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitProgress } from '../../types/git';

const api = vi.hoisted(() => ({ clone: vi.fn(), cancel: vi.fn(), pick: vi.fn(), open: vi.fn() }));
vi.mock('../../ipc/git', async (original) => ({ ...await original<typeof import('../../ipc/git')>(), gitClone: api.clone, gitCancelClone: api.cancel }));
vi.mock('../../ipc/dialog', async (original) => ({ ...await original<typeof import('../../ipc/dialog')>(), pickFolder: api.pick }));
vi.mock('../../editor/vaultFlow', async (original) => ({ ...await original<typeof import('../../editor/vaultFlow')>(), switchVault: api.open }));

import { registerBuiltinCommands } from '../../commands/builtins';
import { useGitCloneStore } from '../../stores/useGitCloneStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useVaultStore } from '../../stores/useVaultStore';
import MenuBar from '../workbench/MenuBar';
import GitCloneDialog from './GitCloneDialog';

const URL = 'git@github.com:owner/repo.git';
const DEST = 'C:/projects/repo';
let dispose: () => void;
const pending: Array<(error: unknown) => void> = [];
function deferredClone() {
  let resolve!: (path: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  pending.push(reject);
  return { promise, resolve, reject };
}

beforeEach(() => {
  pending.length = 0;
  useGitCloneStore.setState(useGitCloneStore.getInitialState(), true);
  useSettingsStore.setState({ simpleMode: false, gitRemoteMode: 'ssh' });
  useVaultStore.setState({ vault: { root: 'C:/old', name: 'old', repoRoot: null } });
  api.clone.mockReset().mockResolvedValue(DEST);
  api.cancel.mockReset().mockResolvedValue(true);
  api.pick.mockReset().mockResolvedValue('C:/projects');
  api.open.mockReset().mockResolvedValue(true);
  dispose = registerBuiltinCommands();
  render(<><MenuBar /><GitCloneDialog /></>);
});
afterEach(async () => {
  await act(async () => {
    for (const reject of pending) reject({ code: 'cancelled', message: 'fixture cleanup' });
    await Promise.resolve();
  });
  cleanup();
  dispose();
  useGitCloneStore.setState(useGitCloneStore.getInitialState(), true);
});

async function form() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: '文件' }));
  await user.click(screen.getByRole('menuitem', { name: /克隆仓库/ }));
  await user.type(screen.getByRole('textbox', { name: '仓库 URL' }), URL);
  await user.click(screen.getByRole('button', { name: '选择目录' }));
  return user;
}

describe('#34 克隆表单与任务闭环', () => {
  it('选择目录取消不会启动克隆或改变当前工作区', async () => {
    api.pick.mockResolvedValue(null);
    const old = useVaultStore.getState().vault;
    await form();
    expect(screen.getByRole('button', { name: '开始克隆' })).toBeDisabled();
    expect(api.clone).not.toHaveBeenCalled();
    expect(useVaultStore.getState().vault).toBe(old);
  });

  it('真实进度按request显示，成功只提供显式打开入口，不随完成结果切库', async () => {
    const operation = deferredClone();
    api.clone.mockReturnValue(operation.promise);
    const old = useVaultStore.getState().vault;
    const user = await form();
    expect(screen.getByRole('textbox', { name: '新目录名称' })).toHaveValue('repo');
    await user.click(screen.getByRole('button', { name: '开始克隆' }));
    expect(api.clone).toHaveBeenCalledWith(URL, DEST, expect.any(Function), expect.any(String));
    const progress = api.clone.mock.calls[0][2] as (value: GitProgress) => void;
    act(() => progress({ line: 'Receiving objects: 50%' }));
    expect(screen.getByRole('log', { name: '克隆进度' })).toHaveTextContent('Receiving objects: 50%');
    expect(api.open).not.toHaveBeenCalled();
    expect(useVaultStore.getState().vault).toBe(old);
    await act(async () => { operation.resolve(DEST); await operation.promise; });
    expect(screen.getByRole('button', { name: '打开工作区' })).toBeEnabled();
    expect(api.open).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '打开工作区' }));
    expect(api.open).toHaveBeenCalledWith(DEST);
    expect(screen.queryByRole('dialog', { name: '克隆仓库' })).not.toBeInTheDocument();
  });

  it('取消等待原任务确认退出，之后可retry且旧进度不能污染新任务', async () => {
    const first = deferredClone();
    const second = deferredClone();
    api.clone.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const user = await form();
    await user.click(screen.getByRole('button', { name: '开始克隆' }));
    const id = api.clone.mock.calls[0][3];
    const oldProgress = api.clone.mock.calls[0][2] as (value: GitProgress) => void;
    await user.click(screen.getByRole('button', { name: '取消克隆' }));
    expect(api.cancel).toHaveBeenCalledWith(id);
    expect(screen.getByRole('status')).toHaveTextContent('正在停止');
    expect(screen.getByRole('button', { name: '取消克隆' })).toBeDisabled();
    await act(async () => { first.reject({ code: 'cancelled', message: '克隆已取消' }); await Promise.resolve(); });
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(api.clone.mock.calls[1][3]).not.toBe(id);
    act(() => oldProgress({ line: 'stale progress must disappear' }));
    expect(screen.queryByText('stale progress must disappear')).not.toBeInTheDocument();
    expect(api.open).not.toHaveBeenCalled();
    await act(async () => { second.resolve(DEST); await second.promise; });
  });

  it('克隆失败保留表单与原工作区，不显示已创建或打开成功', async () => {
    api.clone.mockRejectedValue({ code: 'failed', message: '目标目录已存在，原有文件保持不变。' });
    const old = useVaultStore.getState().vault;
    const user = await form();
    await user.click(screen.getByRole('button', { name: '开始克隆' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('目标目录已存在');
    expect(screen.getByRole('textbox', { name: '仓库 URL' })).toHaveValue(URL);
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '打开工作区' })).not.toBeInTheDocument();
    expect(useVaultStore.getState().vault).toBe(old);
    expect(api.open).not.toHaveBeenCalled();
  });

  it('已克隆但打开失败或用户取消切库时保留成功目录和当前会话，可再次打开', async () => {
    const old = useVaultStore.getState().vault;
    const user = await form();
    await user.click(screen.getByRole('button', { name: '开始克隆' }));
    api.open.mockRejectedValueOnce(new Error('fixture open failed')).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await user.click(await screen.findByRole('button', { name: '打开工作区' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('仓库已克隆，但打开失败');
    expect(useVaultStore.getState().vault).toBe(old);
    await user.click(screen.getByRole('button', { name: '打开工作区' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('当前工作区保持不变');
    await user.click(screen.getByRole('button', { name: '打开工作区' }));
    expect(api.clone).toHaveBeenCalledTimes(1);
    expect(api.open).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('dialog', { name: '克隆仓库' })).not.toBeInTheDocument();
  });

  it('仅本地模式明确阻止提交，不能绕过已有远程策略', async () => {
    useSettingsStore.setState({ gitRemoteMode: 'local' });
    await form();
    expect(screen.getByText(/当前为仅本地模式/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始克隆' })).toBeDisabled();
    expect(api.clone).not.toHaveBeenCalled();
  });

  it('克隆结果晚到只记录完成，不自动打开后来工作区上的旧任务', async () => {
    const operation = deferredClone();
    api.clone.mockReturnValue(operation.promise);
    const user = await form();
    await user.click(screen.getByRole('button', { name: '开始克隆' }));
    const newer = { root: 'C:/newer', name: 'newer', repoRoot: null };
    useVaultStore.setState({ vault: newer });
    await act(async () => { operation.resolve(DEST); await operation.promise; });
    expect(useVaultStore.getState().vault).toBe(newer);
    expect(api.open).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '打开工作区' })).toBeEnabled();
  });

  it('取消请求失败保留进行中任务，可重试取消并只接受真实终态', async () => {
    const operation = deferredClone();
    api.clone.mockReturnValue(operation.promise);
    api.cancel.mockRejectedValueOnce(new Error('fixture cancel unavailable')).mockResolvedValueOnce(true);
    const user = await form();
    await user.click(screen.getByRole('button', { name: '开始克隆' }));
    await user.click(screen.getByRole('button', { name: '取消克隆' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('取消请求失败');
    expect(screen.getByRole('button', { name: '取消克隆' })).toBeEnabled();
    expect(api.open).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '取消克隆' }));
    expect(screen.getByRole('status')).toHaveTextContent('等待任务退出');
    await act(async () => { operation.reject({ code: 'cancelled', message: '已停止并清理' }); await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('克隆已取消');
    expect(screen.getByRole('button', { name: '重试' })).toBeEnabled();
  });

  it('原生回收失败展示保留目录，不能把残留任务标记为取消成功', async () => {
    api.clone.mockRejectedValue({ code: 'failed', message: '无法确认克隆进程已退出', residualPath: 'C:/projects/.inkstream-clone-owned' });
    const old = useVaultStore.getState().vault;
    const user = await form();
    await user.click(screen.getByRole('button', { name: '开始克隆' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保留的目录：C:/projects/.inkstream-clone-owned');
    expect(screen.queryByText(/克隆已取消，可以重试/)).not.toBeInTheDocument();
    expect(useVaultStore.getState().vault).toBe(old);
    expect(api.open).not.toHaveBeenCalled();
  });
});
