import type { ReactNode } from 'react';
import { useSettingsStore } from '../../stores/useSettingsStore';
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
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-[var(--background-primary)] transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
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
  oauth: '用 GitHub 账号登录后经 HTTPS 同步（在账户设置中登录，即将支持）。',
  custom: '连接自建或第三方 git 服务器。',
};
