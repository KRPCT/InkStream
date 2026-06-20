import { hydrate as hydrateMru, list as listMru, subscribe as subscribeMru } from '../commands/mru';
import { loadSettings, saveSettings } from '../ipc/settings';
import type { PersistedSettings } from '../types/settings';
import { useSettingsStore } from './useSettingsStore';
import { useToastStore } from './useToastStore';
import { useWorkbenchStore } from './useWorkbenchStore';
import { validateSettings } from './validateSettings';

/**
 * 持久化管线（D-11，01-RESEARCH.md Pattern 6）：
 * 启动 loadSettings → validateSettings → 应用两 store + MRU → 校正
 * localStorage 'inkstream.boot' 镜像（settings.json 为真相源）；
 * 随后订阅变更，500ms 防抖合并写盘。读失败回默认 + 错误 toast；
 * 写失败警告 toast，不中断 UI（T-01-09）。
 */

const DEBOUNCE_MS = 500;

export const LOAD_ERROR_MESSAGE = '无法读取上次的布局配置，已恢复默认布局。';
export const SAVE_ERROR_MESSAGE = '布局配置保存失败，本次更改在重启后可能丢失。';

let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribers: Array<() => void> = [];

/** 当前内存态快照，写盘前经 validateSettings 再过一遍（防内存异常外溢）。 */
function snapshot(): PersistedSettings {
  const {
    theme,
    autosaveEnabled,
    autosaveDelayMs,
    editorFontSize,
    dailyWordGoal,
    gitRemoteMode,
    gitCustomServer,
    simpleMode,
    exportBrandingFooter,
    exportBrandingText,
  } = useSettingsStore.getState();
  const { mode, layouts } = useWorkbenchStore.getState();
  return validateSettings({
    version: 1,
    theme,
    mode,
    layouts,
    commandMru: listMru(),
    autosaveEnabled,
    autosaveDelayMs,
    editorFontSize,
    dailyWordGoal,
    gitRemoteMode,
    gitCustomServer,
    simpleMode,
    exportBrandingFooter,
    exportBrandingText,
  });
}

function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveSettings(snapshot()).catch(() => {
      useToastStore.getState().showToast('warning', SAVE_ERROR_MESSAGE);
    });
  }, DEBOUNCE_MS);
}

function apply(s: PersistedSettings): void {
  useSettingsStore.getState().setTheme(s.theme);
  // 簇②：无副作用项直接 setState；字体经 setEditorFontSize 落 CSS 变量。
  useSettingsStore.setState({
    autosaveEnabled: s.autosaveEnabled,
    autosaveDelayMs: s.autosaveDelayMs,
    dailyWordGoal: s.dailyWordGoal,
    gitRemoteMode: s.gitRemoteMode,
    gitCustomServer: s.gitCustomServer,
    simpleMode: s.simpleMode,
    exportBrandingFooter: s.exportBrandingFooter,
    exportBrandingText: s.exportBrandingText,
  });
  useSettingsStore.getState().setEditorFontSize(s.editorFontSize);
  useWorkbenchStore.getState().setMode(s.mode);
  useWorkbenchStore.setState({ layouts: s.layouts });
  hydrateMru(s.commandMru);
}

/** 文件读入后整体覆写镜像：不一致以文件为准（FOUC 契约第 3 步）。 */
function correctBootMirror(s: PersistedSettings): void {
  try {
    localStorage.setItem('inkstream.boot', JSON.stringify({ theme: s.theme, mode: s.mode }));
  } catch {
    /* 镜像写失败仅影响下次首帧视觉，不阻塞 */
  }
}

async function doInit(): Promise<void> {
  let settings: PersistedSettings;
  try {
    settings = validateSettings(await loadSettings());
  } catch {
    settings = validateSettings(null);
    useToastStore.getState().showToast('error', LOAD_ERROR_MESSAGE);
  }
  apply(settings);
  correctBootMirror(settings);
  // 订阅在应用之后建立：hydrate 本身不触发写盘
  unsubscribers = [
    useSettingsStore.subscribe(scheduleSave),
    useWorkbenchStore.subscribe(scheduleSave),
    subscribeMru(scheduleSave),
  ];
}

/** App 启动调用（show() 前发起、不阻塞首帧——首帧由 boot.js 镜像保证）。幂等。 */
export function initPersistence(): Promise<void> {
  initPromise ??= doInit();
  return initPromise;
}

/** 复位管线（测试用）：撤销订阅、取消未落盘的防抖定时器。 */
export function resetPersistence(): void {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
  initPromise = null;
}
