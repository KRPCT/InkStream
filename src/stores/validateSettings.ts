import type { AppMode, GitRemoteMode, PersistedSettings, ThemeSetting } from '../types/settings';
import { DEFAULT_LAYOUT, type ModeLayout } from '../types/workbench';

/**
 * settings.json 读入窄校验（Security Domain V5：手写 ~30 行，不引 zod）。
 * 枚举白名单 + 数值钳制 + 缺键补默认；整体异型回 DEFAULT_SETTINGS。
 */

const THEMES: readonly string[] = ['light', 'dark', 'system'];
const MODES: readonly string[] = ['standard', 'academic', 'creative'];
const GIT_MODES: readonly string[] = ['local', 'ssh', 'oauth', 'custom'];
const MRU_LIMIT = 10;

function defaults(): PersistedSettings {
  return {
    version: 1,
    theme: 'system',
    mode: 'standard',
    layouts: {
      standard: { ...DEFAULT_LAYOUT },
      academic: { ...DEFAULT_LAYOUT },
      creative: { ...DEFAULT_LAYOUT },
    },
    commandMru: [],
    autosaveEnabled: true,
    autosaveDelayMs: 500,
    editorFontSize: 16,
    uiZoom: 1,
    dailyWordGoal: 1000,
    gitRemoteMode: 'ssh',
    gitCustomServer: '',
    simpleMode: false,
    exportBrandingFooter: false,
    exportBrandingText: 'Made with InkStream',
    bookshelfEnabled: false,
    terminalEnabled: false,
  };
}

export const DEFAULT_SETTINGS: PersistedSettings = defaults();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function layout(raw: unknown): ModeLayout {
  const o = isRecord(raw) ? raw : {};
  return {
    sidebarWidth: clamp(o.sidebarWidth, 200, 480, DEFAULT_LAYOUT.sidebarWidth),
    rightPanelWidth: clamp(o.rightPanelWidth, 240, 560, DEFAULT_LAYOUT.rightPanelWidth),
    sidebarCollapsed:
      typeof o.sidebarCollapsed === 'boolean' ? o.sidebarCollapsed : DEFAULT_LAYOUT.sidebarCollapsed,
    rightPanelCollapsed:
      typeof o.rightPanelCollapsed === 'boolean'
        ? o.rightPanelCollapsed
        : DEFAULT_LAYOUT.rightPanelCollapsed,
  };
}

/** 任意输入（含投毒文件）收敛为合法 PersistedSettings，永不抛错。 */
export function validateSettings(raw: unknown): PersistedSettings {
  if (!isRecord(raw) || raw.version !== 1) return defaults();
  const layouts = isRecord(raw.layouts) ? raw.layouts : {};
  return {
    version: 1,
    theme: (THEMES.includes(raw.theme as string) ? raw.theme : 'system') as ThemeSetting,
    mode: (MODES.includes(raw.mode as string) ? raw.mode : 'standard') as AppMode,
    layouts: {
      standard: layout(layouts.standard),
      academic: layout(layouts.academic),
      creative: layout(layouts.creative),
    },
    commandMru: Array.isArray(raw.commandMru)
      ? raw.commandMru.filter((x): x is string => typeof x === 'string').slice(0, MRU_LIMIT)
      : [],
    autosaveEnabled: typeof raw.autosaveEnabled === 'boolean' ? raw.autosaveEnabled : true,
    autosaveDelayMs: clamp(raw.autosaveDelayMs, 200, 5000, 500),
    editorFontSize: clamp(raw.editorFontSize, 10, 28, 16),
    uiZoom: clamp(raw.uiZoom, 0.5, 3, 1),
    dailyWordGoal: clamp(raw.dailyWordGoal, 0, 100000, 1000),
    gitRemoteMode: (GIT_MODES.includes(raw.gitRemoteMode as string)
      ? raw.gitRemoteMode
      : 'ssh') as GitRemoteMode,
    gitCustomServer:
      typeof raw.gitCustomServer === 'string' ? raw.gitCustomServer.slice(0, 500) : '',
    simpleMode: typeof raw.simpleMode === 'boolean' ? raw.simpleMode : false,
    exportBrandingFooter:
      typeof raw.exportBrandingFooter === 'boolean' ? raw.exportBrandingFooter : false,
    exportBrandingText:
      typeof raw.exportBrandingText === 'string'
        ? raw.exportBrandingText.slice(0, 200)
        : 'Made with InkStream',
    bookshelfEnabled: typeof raw.bookshelfEnabled === 'boolean' ? raw.bookshelfEnabled : false,
    terminalEnabled: typeof raw.terminalEnabled === 'boolean' ? raw.terminalEnabled : false,
  };
}
