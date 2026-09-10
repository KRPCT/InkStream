import { useEffect, useRef, useState } from 'react';
import { githubDeviceCancel, githubDeviceConfiguration, githubDevicePoll, githubDeviceStart } from '../../ipc/auth';
import { ghCliStatus, gitGithubStatus, gitLoginGithub, gitLoginGithubGh, gitLogoutGithub } from '../../ipc/git';
import { openExternal } from '../../ipc/opener';
import { useHelpStore } from '../../stores/useHelpStore';
import { showToast } from '../../stores/useToastStore';
import type { GithubDeviceStart } from '../../types/githubAuth';

const VERIFY_URL = 'https://github.com/login/device';
const buttonClass = 'rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1.5 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] disabled:opacity-50';
const fieldClass = 'min-w-0 flex-1 rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1.5 text-[12px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]';

interface DeviceAttempt { requestId: string; timer: ReturnType<typeof setTimeout> | null }
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** A page owns its request ID before native HTTP starts, including pending-start cancellation. */
export default function GithubAccountSection() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [loginName, setLoginName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [ghAvailable, setGhAvailable] = useState(false);
  const [clientId, setClientId] = useState('');
  const [configured, setConfigured] = useState(false);
  const [device, setDevice] = useState<GithubDeviceStart | 'starting' | null>(null);
  const [message, setMessage] = useState('');
  const current = useRef<DeviceAttempt | null>(null);
  const mounted = useRef(false);
  const clientEdited = useRef(false);
  const accountRevision = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const revision = accountRevision.current;
    void gitGithubStatus().then((value) => {
      if (mounted.current && revision === accountRevision.current) setLoggedIn(value);
    }).catch((error) => {
      if (mounted.current && revision === accountRevision.current) {
        setLoggedIn(false);
        setMessage(errorText(error));
      }
    });
    void ghCliStatus().then((value) => { if (mounted.current) setGhAvailable(value); }).catch(() => undefined);
    void githubDeviceConfiguration().then((value) => {
      if (mounted.current && !clientEdited.current) setClientId(value.clientId ?? '');
    }).catch(() => undefined).finally(() => { if (mounted.current) setConfigured(true); });
    return () => {
      mounted.current = false;
      const attempt = current.current;
      current.current = null;
      if (attempt?.timer) clearTimeout(attempt.timer);
      if (attempt) void githubDeviceCancel(attempt.requestId).catch(() => undefined);
    };
  }, []);

  const isCurrent = (attempt: DeviceAttempt): boolean => mounted.current && current.current === attempt;

  const retireDevice = async (): Promise<void> => {
    const attempt = current.current;
    current.current = null;
    if (attempt?.timer) clearTimeout(attempt.timer);
    setDevice(null);
    if (attempt) await githubDeviceCancel(attempt.requestId).catch(() => undefined);
  };

  const startDevice = async (): Promise<void> => {
    const appId = clientId.trim();
    if (!appId || busy) return;
    const revision = ++accountRevision.current;
    setLoggedIn(false);
    await retireDevice();
    if (!mounted.current || revision !== accountRevision.current) return;
    const attempt: DeviceAttempt = { requestId: crypto.randomUUID(), timer: null };
    current.current = attempt;
    setDevice('starting');
    setMessage('正在获取验证码…');
    try {
      const info = await githubDeviceStart(attempt.requestId, appId);
      if (!isCurrent(attempt)) return;
      if (info.requestId !== attempt.requestId || info.verificationUri !== VERIFY_URL) {
        throw new Error('GitHub 返回的登录会话不匹配，请重新获取验证码。');
      }
      setDevice(info);
      setMessage('在 GitHub 验证页面输入此验证码，并确认授权。');

      const finish = (text: string): void => {
        if (!isCurrent(attempt)) return;
        current.current = null;
        setDevice(null);
        setMessage(text);
        void githubDeviceCancel(attempt.requestId).catch(() => undefined);
      };
      const schedule = (delay: number): void => {
        if (!isCurrent(attempt)) return;
        const remaining = info.expiresAt - Date.now();
        if (remaining <= 0) { finish('验证码已过期，请重新登录。'); return; }
        attempt.timer = setTimeout(() => { void poll(); }, Math.min(Math.max(1, delay), remaining));
      };
      const poll = async (): Promise<void> => {
        if (!isCurrent(attempt)) return;
        attempt.timer = null;
        if (Date.now() >= info.expiresAt) { finish('验证码已过期，请重新登录。'); return; }
        try {
          const result = await githubDevicePoll(attempt.requestId);
          if (!isCurrent(attempt)) return;
          if (result.status === 'pending') { schedule(result.retryAfterMs); return; }
          if (result.status === 'authorized') {
            accountRevision.current += 1;
            setLoggedIn(true);
            setLoginName(result.login);
            setToken('');
            finish('GitHub 登录成功。');
          } else {
            finish(result.status === 'denied' ? '已拒绝 GitHub 授权，可以重新登录。'
              : result.status === 'expired' ? '验证码已过期，请重新登录。' : '设备登录已取消。');
          }
        } catch (error) { finish(`设备登录失败：${errorText(error)}`); }
      };
      schedule(info.intervalMs);
    } catch (error) {
      if (!isCurrent(attempt)) return;
      setMessage(`无法开始设备登录：${errorText(error)}`);
      await retireDevice();
    }
  };

  const changeAccount = async (kind: 'pat' | 'gh' | 'logout'): Promise<void> => {
    if (busy) return;
    const value = token.trim();
    if (kind === 'pat' && !value) return;
    setBusy(true);
    accountRevision.current += 1;
    if (loggedIn === null) setLoggedIn(false);
    try {
      await retireDevice();
      if (kind === 'pat') await gitLoginGithub(value);
      else if (kind === 'gh') await gitLoginGithubGh();
      else await gitLogoutGithub();
      if (!mounted.current) return;
      setLoggedIn(kind !== 'logout');
      setLoginName('');
      setToken('');
      setMessage(kind === 'logout' ? '已登出 GitHub。' : 'GitHub 凭据已保存。');
    } catch (error) { if (mounted.current) showToast('error', `账户操作失败：${errorText(error)}`); }
    finally { if (mounted.current) setBusy(false); }
  };

  return <div className="space-y-4 py-3">
    <div>
      <p className="text-[13px] text-[var(--text-normal)]">GitHub</p>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-muted)]">
        用于 GitHub 仓库同步、Pull Request 和 Issue。凭据保存在本机系统凭据库。
      </p>
    </div>
    {loggedIn === null && <p className="text-[12px] text-[var(--text-muted)]">检查登录状态…</p>}
    {loggedIn ? <div className="flex items-center justify-between gap-3">
      <p className="text-[13px] text-[var(--text-normal)]">已登录{loginName ? `：${loginName}` : ' GitHub'}</p>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void changeAccount('logout')}>登出 GitHub</button>
    </div> : <>
      <div className="space-y-2">
        <label className="block text-[12px] text-[var(--text-muted)]" htmlFor="github-oauth-client-id">OAuth App Client ID</label>
        <input id="github-oauth-client-id" value={clientId} disabled={busy || device !== null}
          className={`${fieldClass} w-full`} autoComplete="off" spellCheck={false}
          onChange={(event) => { clientEdited.current = true; setClientId(event.target.value); }} />
        {configured && !clientId.trim() && <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
          此版本尚未配置发布用 Client ID。可填写自己的 GitHub OAuth App Client ID，并在应用设置中启用 Device Flow。
        </p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!configured || !clientId.trim() || busy || device !== null}
            className={buttonClass} onClick={() => void startDevice()}>通过浏览器登录 GitHub</button>
          {device && <>
            <button type="button" className={buttonClass} onClick={() => { accountRevision.current += 1; void retireDevice(); setMessage('设备登录已取消。'); }}>取消设备登录</button>
            <button type="button" className={buttonClass} onClick={() => void startDevice()}>重新获取验证码</button>
          </>}
        </div>
        {device && device !== 'starting' && <div className="space-y-2 border-l-2 border-[var(--accent)] py-2 pl-3">
          <output aria-label="GitHub 设备验证码" className="select-text font-mono text-[22px] tracking-widest text-[var(--text-normal)]">{device.userCode}</output>
          <div><button type="button" className={buttonClass} onClick={() => { void openExternal(VERIFY_URL).catch((error) => showToast('error', `打开浏览器失败：${errorText(error)}`)); }}>打开 GitHub 验证页面</button></div>
        </div>}
      </div>
      <div className="space-y-2 border-t border-[var(--background-modifier-border)] pt-3">
        <label htmlFor="github-pat" className="block text-[12px] text-[var(--text-muted)]">GitHub Personal Access Token</label>
        <div className="flex gap-2">
          <input id="github-pat" type="password" value={token} autoComplete="off" spellCheck={false}
            disabled={busy} onChange={(event) => setToken(event.target.value)} className={fieldClass} />
          <button type="button" className={buttonClass} disabled={busy || !token.trim()} onClick={() => void changeAccount('pat')}>使用 PAT 登录</button>
        </div>
        {ghAvailable && <button type="button" className={buttonClass} disabled={busy} onClick={() => void changeAccount('gh')}>使用本机 gh CLI 登录</button>}
      </div>
    </>}
    {message && <p role="status" className="text-[12px] leading-relaxed text-[var(--text-muted)]">{message}</p>}
    <button type="button" className="text-[12px] text-[var(--accent)] hover:underline"
      onClick={() => useHelpStore.getState().openHelp('sync')}>查看多设备同步教程 →</button>
  </div>;
}
