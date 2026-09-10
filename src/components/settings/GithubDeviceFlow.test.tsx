import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { githubDeviceCancel, githubDeviceConfiguration, githubDevicePoll, githubDeviceStart } from '../../ipc/auth';
import { ghCliStatus, gitGithubStatus, gitLoginGithub, gitLoginGithubGh, gitLogoutGithub } from '../../ipc/git';
import { openExternal } from '../../ipc/opener';
import { useToastStore } from '../../stores/useToastStore';
import type { GithubDeviceStart } from '../../types/githubAuth';
import { AccountSection } from './settingsSections';

vi.mock('../../ipc/auth', () => ({
  githubDeviceConfiguration: vi.fn(), githubDeviceStart: vi.fn(),
  githubDevicePoll: vi.fn(), githubDeviceCancel: vi.fn(),
}));
vi.mock('../../ipc/git', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../ipc/git')>(),
  gitGithubStatus: vi.fn(), ghCliStatus: vi.fn(), gitLoginGithub: vi.fn(),
  gitLoginGithubGh: vi.fn(), gitLogoutGithub: vi.fn(),
}));
vi.mock('../../ipc/opener', () => ({ openExternal: vi.fn(async () => undefined) }));

const CLIENT_ID = 'published-app-client-id';
const VERIFY = 'https://github.com/login/device';
const startResult = (requestId: string, userCode = 'WDJB-MJHT'): GithubDeviceStart => ({
  requestId, userCode, verificationUri: VERIFY, expiresAt: Date.now() + 900_000, intervalMs: 5_000,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(gitGithubStatus).mockReset().mockResolvedValue(false);
  vi.mocked(ghCliStatus).mockReset().mockResolvedValue(true);
  vi.mocked(gitLoginGithub).mockReset().mockResolvedValue(null);
  vi.mocked(gitLoginGithubGh).mockReset().mockResolvedValue(null);
  vi.mocked(gitLogoutGithub).mockReset().mockResolvedValue(null);
  vi.mocked(githubDeviceConfiguration).mockReset().mockResolvedValue({ clientId: CLIENT_ID });
  vi.mocked(githubDeviceStart).mockReset().mockImplementation(async (requestId) => startResult(requestId));
  vi.mocked(githubDevicePoll).mockReset().mockResolvedValue({ status: 'pending', retryAfterMs: 5_000 });
  vi.mocked(githubDeviceCancel).mockReset().mockResolvedValue(true);
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
});

afterEach(async () => {
  cleanup();
  await Promise.resolve();
  for (const toast of useToastStore.getState().toasts) useToastStore.getState().dismiss(toast.id);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function mount() {
  const result = render(<AccountSection />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return result;
}

async function start() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '通过浏览器登录 GitHub' }));
    await vi.advanceTimersByTimeAsync(0);
  });
  const requestId = vi.mocked(githubDeviceStart).mock.calls.at(-1)?.[0];
  expect(requestId).toEqual(expect.any(String));
  expect(requestId?.length).toBeGreaterThan(8);
  return requestId!;
}

describe('GitHub Device Flow 账户入口', () => {
  it('发布 Client ID 获取公开验证码，只打开固定 GitHub 验证页，首次轮询尊重最小间隔', async () => {
    await mount();
    const requestId = await start();
    expect(githubDeviceStart).toHaveBeenCalledWith(requestId, CLIENT_ID);
    expect(screen.getByLabelText('GitHub 设备验证码')).toHaveTextContent('WDJB-MJHT');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '打开 GitHub 验证页面' })); });
    expect(openExternal).toHaveBeenCalledWith(VERIFY);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_999); });
    expect(githubDevicePoll).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(githubDevicePoll).toHaveBeenCalledWith(requestId);
  });

  it('没有发布 Client ID 时说明配置方法，填写自己的公开 App ID 后可登录', async () => {
    vi.mocked(githubDeviceConfiguration).mockResolvedValue({ clientId: null });
    await mount();
    expect(screen.getByRole('button', { name: '通过浏览器登录 GitHub' })).toBeDisabled();
    expect(screen.getByText(/尚未配置.*Client ID/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('OAuth App Client ID'), { target: { value: 'my-own-app' } });
    const requestId = await start();
    expect(githubDeviceStart).toHaveBeenCalledWith(requestId, 'my-own-app');
  });

  it('原生刷新发现授权失效时，账户入口显示重新登录原因', async () => {
    vi.mocked(gitGithubStatus).mockRejectedValueOnce('GitHub 授权已失效，请在账户设置重新登录。');
    await mount();
    expect(screen.getByRole('status')).toHaveTextContent('GitHub 授权已失效');
    expect(screen.getByRole('button', { name: '通过浏览器登录 GitHub' })).toBeEnabled();
  });

  it('slow_down 的新等待时间用于下一轮，授权成功后停止轮询并显示账户', async () => {
    vi.mocked(githubDevicePoll)
      .mockResolvedValueOnce({ status: 'pending', retryAfterMs: 12_000 })
      .mockResolvedValueOnce({ status: 'authorized', login: 'octocat' });
    await mount();
    await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(githubDevicePoll).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(11_999); });
    expect(githubDevicePoll).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByText(/已登录.*octocat/)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(githubDevicePoll).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: 'denied' as const, message: /已拒绝|已取消授权/ },
    { status: 'expired' as const, message: /已过期/ },
  ])('$status 停止轮询，保留明确的重新登录入口', async ({ status, message }) => {
    vi.mocked(githubDevicePoll).mockResolvedValueOnce({ status });
    await mount();
    await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '通过浏览器登录 GitHub' })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(githubDevicePoll).toHaveBeenCalledTimes(1);
  });

  it('start 尚未返回就取消：立即用原 requestId 退休原生请求，迟到验证码不能回到 UI', async () => {
    let resolveStart!: (value: GithubDeviceStart) => void;
    vi.mocked(githubDeviceStart).mockReturnValueOnce(new Promise((resolve) => { resolveStart = resolve; }));
    await mount();
    const requestId = await start();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '取消设备登录' })); });
    expect(githubDeviceCancel).toHaveBeenCalledWith(requestId);
    await act(async () => { resolveStart(startResult(requestId)); await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.queryByLabelText('GitHub 设备验证码')).not.toBeInTheDocument();
    expect(githubDevicePoll).not.toHaveBeenCalled();
  });

  it('重新开始使用新 requestId，原 start 迟到不能盖掉新验证码', async () => {
    let resolveOld!: (value: GithubDeviceStart) => void;
    vi.mocked(githubDeviceStart).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
    await mount();
    const oldId = await start();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重新获取验证码' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    const newId = vi.mocked(githubDeviceStart).mock.calls[1][0];
    expect(newId).not.toBe(oldId);
    expect(githubDeviceCancel).toHaveBeenCalledWith(oldId);
    await act(async () => { resolveOld(startResult(oldId, 'OLDX-CODE')); });
    expect(screen.getByLabelText('GitHub 设备验证码')).toHaveTextContent('WDJB-MJHT');
    expect(screen.queryByText('OLDX-CODE')).not.toBeInTheDocument();
  });

  it('设备轮询在飞时改用 PAT，原生取消先于 PAT 登录，迟到授权不能覆盖新登录状态', async () => {
    let resolvePoll!: (value: { status: 'authorized'; login: string }) => void;
    vi.mocked(githubDevicePoll).mockReturnValueOnce(new Promise((resolve) => { resolvePoll = resolve; }));
    await mount();
    const requestId = await start();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    fireEvent.change(screen.getByLabelText('GitHub Personal Access Token'), { target: { value: 'fixture-pat-not-a-real-secret' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '使用 PAT 登录' })); });
    expect(githubDeviceCancel).toHaveBeenCalledWith(requestId);
    expect(vi.mocked(githubDeviceCancel).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(gitLoginGithub).mock.invocationCallOrder[0]);
    expect(gitLoginGithub).toHaveBeenCalledWith('fixture-pat-not-a-real-secret');
    await act(async () => { resolvePoll({ status: 'authorized', login: 'old-device-account' }); });
    expect(screen.queryByText(/old-device-account/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登出 GitHub' })).toBeEnabled();
  });

  it('设备登录等待期间仍可使用本机 gh；退出账户后不显示旧验证码', async () => {
    await mount();
    const requestId = await start();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /使用本机 gh CLI 登录/ })); });
    expect(githubDeviceCancel).toHaveBeenCalledWith(requestId);
    expect(gitLoginGithubGh).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '登出 GitHub' })); });
    expect(gitLogoutGithub).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('GitHub 设备验证码')).not.toBeInTheDocument();
  });

  it('账户页面卸载时取消属于该页面的请求，不遗留轮询', async () => {
    const mounted = await mount();
    const requestId = await start();
    mounted.unmount();
    expect(githubDeviceCancel).toHaveBeenCalledWith(requestId);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(githubDevicePoll).not.toHaveBeenCalled();
  });

  it('取消 IPC 迟到时较早的重试不能越过更新的登录意图', async () => {
    let resolveCancel!: (cancelled: boolean) => void;
    await mount();
    await start();
    vi.mocked(githubDeviceCancel).mockReturnValueOnce(new Promise((resolve) => { resolveCancel = resolve; }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重新获取验证码' })); });
    const newest = await start();
    expect(githubDeviceStart).toHaveBeenCalledTimes(2);
    await act(async () => { resolveCancel(true); await vi.advanceTimersByTimeAsync(0); });
    expect(githubDeviceStart).toHaveBeenCalledTimes(2);
    expect(vi.mocked(githubDeviceStart).mock.calls.at(-1)?.[0]).toBe(newest);
    expect(screen.getByLabelText('GitHub 设备验证码')).toHaveTextContent('WDJB-MJHT');
  });
});
