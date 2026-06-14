import { create } from 'zustand';
import { subscribeSystemTheme, type Unsubscribe } from '../ipc/theme';
import type { GitRemoteMode, ResolvedTheme, ThemeSetting } from '../types/settings';

interface SettingsState {
  theme: ThemeSetting;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeSetting) => void;
  // ── 簇② 用户可调项 ──
  autosaveEnabled: boolean;
  autosaveDelayMs: number;
  editorFontSize: number;
  gitRemoteMode: GitRemoteMode;
  gitCustomServer: string;
  setAutosaveEnabled: (enabled: boolean) => void;
  setAutosaveDelayMs: (ms: number) => void;
  setEditorFontSize: (px: number) => void;
  setGitRemoteMode: (mode: GitRemoteMode) => void;
  setGitCustomServer: (server: string) => void;
}

/** 字体大小落到 CSS 变量（编辑器 .cm-editor 经 var(--editor-font-size) 消费，见 app.css）。 */
function applyFontSize(px: number): void {
  document.documentElement.style.setProperty('--editor-font-size', `${px}px`);
}

let systemUnsubscribe: Unsubscribe | null = null;

function systemResolved(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyResolved(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

/** 双写 localStorage 镜像（merge，不覆盖 mode 字段）。镜像仅供 boot.js 首帧消费。 */
function writeBootMirror(theme: ThemeSetting): void {
  let boot: Record<string, unknown> = {};
  try {
    boot = (JSON.parse(localStorage.getItem('inkstream.boot') ?? '{}') as typeof boot) ?? {};
  } catch {
    boot = {};
  }
  boot.theme = theme;
  try {
    localStorage.setItem('inkstream.boot', JSON.stringify(boot));
  } catch {
    /* 镜像写失败仅影响下次首帧视觉，不阻塞 */
  }
}

/**
 * theme === 'system' 时激活系统主题订阅（subscribeSystemTheme 内部走
 * windowControls.onThemeChanged，失败回退 matchMedia）；resolved 变更同步 DOM 与 state。
 */
function followSystem(set: (partial: Partial<SettingsState>) => void): void {
  systemUnsubscribe?.();
  systemUnsubscribe = subscribeSystemTheme((t) => {
    applyResolved(t);
    set({ resolvedTheme: t });
  });
}

/**
 * 主题三态状态层（D-13）。settings.json 落盘属 Plan 06，本阶段为内存态 + 镜像。
 * 任何变更同步三件事：写 documentElement data-theme、双写镜像、按需切换系统订阅。
 */
export const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: (theme) => {
    systemUnsubscribe?.();
    systemUnsubscribe = null;
    const resolved = theme === 'system' ? systemResolved() : theme;
    applyResolved(resolved);
    writeBootMirror(theme);
    set({ theme, resolvedTheme: resolved });
    if (theme === 'system') followSystem(set);
  },
  // 簇② 默认值（启动时由 persistSettings.apply 以磁盘值覆写）。
  autosaveEnabled: true,
  autosaveDelayMs: 500,
  editorFontSize: 16,
  gitRemoteMode: 'ssh',
  gitCustomServer: '',
  setAutosaveEnabled: (autosaveEnabled) => set({ autosaveEnabled }),
  setAutosaveDelayMs: (autosaveDelayMs) => set({ autosaveDelayMs }),
  setEditorFontSize: (editorFontSize) => {
    applyFontSize(editorFontSize);
    set({ editorFontSize });
  },
  setGitRemoteMode: (gitRemoteMode) => set({ gitRemoteMode }),
  setGitCustomServer: (gitCustomServer) => set({ gitCustomServer }),
}));

/**
 * main.tsx 挂载前调用一次：以 boot.js 已设的 data-theme 为初始 resolved，
 * 以镜像中的 theme 设定为初始三态，避免首帧抖动；system 时立即接管系统订阅。
 */
export function initSettingsFromDocument(): void {
  const resolved: ResolvedTheme =
    document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  let theme: ThemeSetting = 'system';
  try {
    const boot = JSON.parse(localStorage.getItem('inkstream.boot') ?? '{}') as {
      theme?: unknown;
    };
    if (boot.theme === 'light' || boot.theme === 'dark' || boot.theme === 'system') {
      theme = boot.theme;
    }
  } catch {
    /* 镜像损坏：落默认 system */
  }
  useSettingsStore.setState({ theme, resolvedTheme: resolved });
  if (theme === 'system') {
    followSystem((partial) => useSettingsStore.setState(partial));
  }
}
