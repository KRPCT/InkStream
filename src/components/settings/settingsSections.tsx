import { type ReactNode, useEffect, useState } from 'react';
import {
  ghCliStatus,
  gitGithubStatus,
  gitLoginGithub,
  gitLoginGithubGh,
  gitLogoutGithub,
} from '../../ipc/git';
import {
  zoteroClearCredentials,
  zoteroCredentialsStatus,
  zoteroSetCredentials,
  zoteroSync,
} from '../../ipc/zotero';
import { useHelpStore } from '../../stores/useHelpStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { showToast } from '../../stores/useToastStore';
import type { GitRemoteMode, ThemeSetting } from '../../types/settings';

/**
 * 设置分区内容 + 可复用控件（簇②）。控件色全走 CSS 变量（无硬编色）。
 * 改动即写 useSettingsStore（persistSettings 订阅 500ms 防抖落盘 settings.json）。
 */

// ── 可复用控件 ───────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--background-modifier-border)] py-3">
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--text-normal)]">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">{description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--background-modifier-border)]'
      }`}
    >
      {/* 旋钮加投影：浅主题近白旋钮在浅灰关态轨道上才看得清（否则像空药丸）。行程对称到位（关 2px、开 flush）。 */}
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[var(--background-primary)] shadow-[0_1px_2px_rgb(0_0_0/0.35)] transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-[4px] border border-[var(--background-modifier-border)]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-[12px] ${
            value === o.value
              ? 'bg-[var(--accent)] text-[var(--background-primary)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--background-modifier-hover)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-16 rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1 text-right text-[12px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
      />
      {suffix ? <span className="text-[12px] text-[var(--text-faint)]">{suffix}</span> : null}
    </div>
  );
}

// ── 分区 ─────────────────────────────────────────────────────

export function AppearanceSection() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const fontSize = useSettingsStore((s) => s.editorFontSize);
  const setFontSize = useSettingsStore((s) => s.setEditorFontSize);
  return (
    <div>
      <SettingRow label="主题" description="界面亮暗，或跟随系统。">
        <Segmented<ThemeSetting>
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: '亮色' },
            { value: 'dark', label: '暗色' },
            { value: 'system', label: '跟随系统' },
          ]}
        />
      </SettingRow>
      <SettingRow label="编辑器字体大小" description="正文与编辑区字号。">
        <NumberInput value={fontSize} min={10} max={28} suffix="px" onChange={setFontSize} />
      </SettingRow>
    </div>
  );
}

export function EditorSection() {
  const autosave = useSettingsStore((s) => s.autosaveEnabled);
  const setAutosave = useSettingsStore((s) => s.setAutosaveEnabled);
  const delay = useSettingsStore((s) => s.autosaveDelayMs);
  const setDelay = useSettingsStore((s) => s.setAutosaveDelayMs);
  const goal = useSettingsStore((s) => s.dailyWordGoal);
  const setGoal = useSettingsStore((s) => s.setDailyWordGoal);
  return (
    <div>
      <SettingRow
        label="自动保存"
        description="编辑后自动落盘。关闭后需手动保存（Ctrl+S）；未保存的更改仍保留在编辑器中。"
      >
        <Toggle checked={autosave} onChange={setAutosave} />
      </SettingRow>
      <SettingRow label="自动保存延迟" description="停止输入后多久落盘（自动保存开启时生效）。">
        <NumberInput
          value={delay}
          min={200}
          max={5000}
          step={100}
          suffix="ms"
          onChange={setDelay}
        />
      </SettingRow>
      <SettingRow label="今日字数目标" description="Creative 模式状态栏显示今日写作进度（0 = 关闭）。">
        <NumberInput value={goal} min={0} max={100000} step={100} suffix="字" onChange={setGoal} />
      </SettingRow>
    </div>
  );
}

export function GitSection() {
  const mode = useSettingsStore((s) => s.gitRemoteMode);
  const setMode = useSettingsStore((s) => s.setGitRemoteMode);
  const server = useSettingsStore((s) => s.gitCustomServer);
  const setServer = useSettingsStore((s) => s.setGitCustomServer);
  return (
    <div>
      <SettingRow label="远程方式" description="如何与云端仓库同步。">
        <Segmented<GitRemoteMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'local', label: '仅本地' },
            { value: 'ssh', label: 'SSH' },
            { value: 'oauth', label: 'GitHub 登录' },
            { value: 'custom', label: '自定义服务器' },
          ]}
        />
      </SettingRow>
      <SettingRow label="说明" description={MODE_DESC[mode]}>
        <span />
      </SettingRow>
      {mode === 'custom' ? (
        <SettingRow label="自定义服务器地址" description="自建或第三方 git 服务器（如 git.example.com）。">
          <input
            type="text"
            value={server}
            placeholder="git@example.com:user/repo.git"
            onChange={(e) => setServer(e.target.value)}
            className="w-56 rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1 text-[12px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
          />
        </SettingRow>
      ) : null}
    </div>
  );
}

const MODE_DESC: Record<GitRemoteMode, string> = {
  local: '仅在本机做版本管理（提交/分支/回滚），不连任何远程。',
  ssh: '用 SSH 密钥与远程同步（推荐，支持 ed25519）。需把公钥加入 GitHub/服务器。',
  oauth: '用 GitHub 令牌经 HTTPS 同步。在「账户」分区登录后，HTTPS 远程会自动带上令牌。',
  custom: '连接自建或第三方 git 服务器。',
};

function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
}

export function AccountSection() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [ghAvailable, setGhAvailable] = useState(false);

  useEffect(() => {
    void gitGithubStatus()
      .then(setLoggedIn)
      .catch(() => setLoggedIn(false));
    void ghCliStatus()
      .then(setGhAvailable)
      .catch(() => setGhAvailable(false));
  }, []);

  const login = async (): Promise<void> => {
    const t = token.trim();
    if (!t) return;
    setBusy(true);
    try {
      await gitLoginGithub(t);
      setToken('');
      setLoggedIn(true);
    } catch (e) {
      showToast('error', `登录失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const loginGh = async (): Promise<void> => {
    setBusy(true);
    try {
      await gitLoginGithubGh();
      setLoggedIn(true);
    } catch (e) {
      showToast('error', `gh CLI 登录失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const logout = async (): Promise<void> => {
    setBusy(true);
    try {
      await gitLogoutGithub();
      setLoggedIn(false);
    } catch (e) {
      showToast('error', `登出失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {loggedIn === null ? (
        <p className="py-3 text-[13px] text-[var(--text-muted)]">检查登录状态…</p>
      ) : loggedIn ? (
        <SettingRow label="GitHub" description="已登录。HTTPS 远程会自动带上令牌，可推送/拉取/克隆。">
          <button
            type="button"
            disabled={busy}
            onClick={() => void logout()}
            className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] disabled:text-[var(--text-faint)]"
          >
            登出
          </button>
        </SettingRow>
      ) : (
        <div className="py-3">
          <div className="text-[13px] text-[var(--text-normal)]">GitHub 个人访问令牌（PAT）</div>
          <div className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">
            用于经 HTTPS 同步；也可改用 SSH（见「Git ▸ 远程方式」）。令牌仅保存在本机 OS 凭据库，不会上传。
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="password"
              value={token}
              placeholder="ghp_..."
              onChange={(e) => setToken(e.target.value)}
              className="min-w-0 flex-1 rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1 text-[12px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              disabled={busy || !token.trim()}
              onClick={() => void login()}
              className="shrink-0 rounded-[4px] bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-[var(--background-primary)] disabled:opacity-50"
            >
              登录
            </button>
          </div>
          {ghAvailable ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void loginGh()}
              className="mt-2 rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] disabled:opacity-50"
            >
              用本机 gh CLI 一键登录（已检测到登录态）
            </button>
          ) : null}
          <p className="mt-2 text-[12px] leading-snug text-[var(--text-faint)]">
            在 GitHub ▸ Settings ▸ Developer settings ▸ Personal access tokens 创建一个含 repo 权限的令牌。
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={() => useHelpStore.getState().openHelp('sync')}
        className="mt-3 text-[12px] text-[var(--accent)] hover:underline"
      >
        查看多设备同步教程 →
      </button>
    </div>
  );
}

export function ZoteroSection() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [savedUserId, setSavedUserId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const refresh = (): void => {
    void zoteroCredentialsStatus()
      .then((s) => {
        setConfigured(s.hasKey);
        setSavedUserId(s.userId);
      })
      .catch(() => setConfigured(false));
  };
  useEffect(refresh, []);

  const save = async (): Promise<void> => {
    if (!apiKey.trim() || !userId.trim()) return;
    setBusy(true);
    try {
      await zoteroSetCredentials(apiKey.trim(), userId.trim());
      setApiKey('');
      setUserId('');
      refresh();
    } catch (e) {
      showToast('error', `保存失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const clear = async (): Promise<void> => {
    setBusy(true);
    try {
      await zoteroClearCredentials();
      setConfigured(false);
      setSavedUserId('');
    } catch (e) {
      showToast('error', `清除失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const sync = async (): Promise<void> => {
    setBusy(true);
    setSyncMsg('');
    try {
      const r = await zoteroSync();
      setSyncMsg(
        `同步完成：更新 ${r.synced} 条${r.removed ? `、删除 ${r.removed} 条` : ''}（库版本 ${r.version}）。`,
      );
    } catch (e) {
      showToast('error', `同步失败：${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="py-3 text-[12px] leading-snug text-[var(--text-muted)]">
        配置 Zotero Web API 后，可把文献库同步到本地缓存——Zotero 未运行时，文献库与参考文献仍可离线读取。
        API Key 仅保存在本机 OS 凭据库，不会上传或回传界面。
      </p>
      {configured ? (
        <>
          <SettingRow label="已配置" description={`userID：${savedUserId}`}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void clear()}
              className="rounded-[4px] border border-[var(--background-modifier-border)] px-3 py-1 text-[12px] text-[var(--text-normal)] hover:bg-[var(--background-modifier-hover)] disabled:text-[var(--text-faint)]"
            >
              清除凭据
            </button>
          </SettingRow>
          <SettingRow label="增量同步" description="拉取上次同步以来的改动，落地本地缓存。">
            <button
              type="button"
              disabled={busy}
              onClick={() => void sync()}
              className="rounded-[4px] bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-[var(--background-primary)] disabled:opacity-50"
            >
              {busy ? '同步中…' : '立即同步'}
            </button>
          </SettingRow>
          {syncMsg ? (
            <p className="py-2 text-[12px] leading-snug text-[var(--text-muted)]">{syncMsg}</p>
          ) : null}
        </>
      ) : (
        <div className="py-1">
          <div className="mt-2 flex flex-col gap-2">
            <input
              type="text"
              value={userId}
              placeholder="userID（数字，见 zotero.org/settings/keys）"
              onChange={(e) => setUserId(e.target.value)}
              className="rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1 text-[12px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
            />
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={apiKey}
                placeholder="API Key"
                onChange={(e) => setApiKey(e.target.value)}
                className="min-w-0 flex-1 rounded-[4px] border border-[var(--background-modifier-border)] bg-[var(--background-primary)] px-2 py-1 text-[12px] text-[var(--text-normal)] outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                disabled={busy || !apiKey.trim() || !userId.trim()}
                onClick={() => void save()}
                className="shrink-0 rounded-[4px] bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-[var(--background-primary)] disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-snug text-[var(--text-faint)]">
            在 zotero.org ▸ Settings ▸ Feeds/API ▸ Create new private key 创建一个含「Allow library
            access」的只读 Key；userID 显示在同一页面。
          </p>
        </div>
      )}
    </div>
  );
}
