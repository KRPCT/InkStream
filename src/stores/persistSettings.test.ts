import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { hydrate, record } from '../commands/mru';
import { loadSettings, saveSettings } from '../ipc/settings';
import { DEFAULT_LAYOUT } from '../types/workbench';
import {
  LOAD_ERROR_MESSAGE,
  SAVE_ERROR_MESSAGE,
  initPersistence,
  resetPersistence,
} from './persistSettings';
import { useSettingsStore } from './useSettingsStore';
import { useToastStore } from './useToastStore';
import { useWorkbenchStore } from './useWorkbenchStore';

vi.mock('../ipc/settings', () => ({
  loadSettings: vi.fn().mockResolvedValue({}),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

const mockLoad = loadSettings as Mock;
const mockSave = saveSettings as Mock;

const FILE_SETTINGS = {
  version: 1,
  theme: 'dark',
  mode: 'academic',
  layouts: {
    standard: { ...DEFAULT_LAYOUT, sidebarWidth: 300 },
    academic: { ...DEFAULT_LAYOUT, rightPanelWidth: 400 },
    creative: { ...DEFAULT_LAYOUT },
  },
  commandMru: ['theme.dark', 'view.toggle-sidebar'],
};

describe('persistSettings', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockLoad.mockResolvedValue({});
    mockSave.mockResolvedValue(undefined);
    resetPersistence();
    useSettingsStore.setState({ theme: 'system', resolvedTheme: 'light' });
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useToastStore.setState({ toasts: [] });
    hydrate([]);
    localStorage.clear();
    delete document.documentElement.dataset.mode;
  });

  afterEach(() => {
    resetPersistence();
    vi.useRealTimers();
  });

  it('hydrate：文件设置应用到两 store 与 MRU，镜像校正为文件值', async () => {
    mockLoad.mockResolvedValue(FILE_SETTINGS);
    await initPersistence();
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(useWorkbenchStore.getState().mode).toBe('academic');
    expect(useWorkbenchStore.getState().layouts.standard.sidebarWidth).toBe(300);
    expect(useWorkbenchStore.getState().layouts.academic.rightPanelWidth).toBe(400);
    const boot = JSON.parse(localStorage.getItem('inkstream.boot') ?? '{}') as Record<string, unknown>;
    expect(boot).toEqual({ theme: 'dark', mode: 'academic' });
  });

  it('防抖：500ms 窗口内多次变更只写一次盘', async () => {
    await initPersistence();
    mockSave.mockClear();
    useWorkbenchStore.getState().setLayout({ sidebarWidth: 310 });
    await vi.advanceTimersByTimeAsync(200);
    useWorkbenchStore.getState().setLayout({ sidebarWidth: 320 });
    useWorkbenchStore.getState().setLayout({ sidebarWidth: 330 });
    await vi.advanceTimersByTimeAsync(499);
    expect(mockSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('写盘 payload 形状 = { version:1, theme, mode, layouts, commandMru }', async () => {
    await initPersistence();
    mockSave.mockClear();
    useSettingsStore.getState().setTheme('dark');
    await vi.advanceTimersByTimeAsync(500);
    expect(mockSave).toHaveBeenCalledWith({
      version: 1,
      theme: 'dark',
      mode: 'standard',
      layouts: useWorkbenchStore.getState().layouts,
      commandMru: [],
      autosaveEnabled: true,
      autosaveDelayMs: 500,
      editorFontSize: 16,
      dailyWordGoal: 1000,
      gitRemoteMode: 'ssh',
      gitCustomServer: '',
      simpleMode: false,
      exportBrandingFooter: false,
      exportBrandingText: 'Made with InkStream',
      bookshelfEnabled: false,
    });
  });

  it('load 失败：应用 DEFAULT_SETTINGS 并弹错误 toast（UI-SPEC 字面）', async () => {
    mockLoad.mockRejectedValue(new Error('disk error'));
    await initPersistence();
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(useWorkbenchStore.getState().mode).toBe('standard');
    expect(useWorkbenchStore.getState().layouts.standard).toEqual(DEFAULT_LAYOUT);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe('error');
    expect(toasts[0].message).toBe('无法读取上次的布局配置，已恢复默认布局。');
    expect(LOAD_ERROR_MESSAGE).toBe('无法读取上次的布局配置，已恢复默认布局。');
  });

  it('save 失败：弹警告 toast（UI-SPEC 字面），UI 不中断', async () => {
    await initPersistence();
    mockSave.mockRejectedValue(new Error('disk full'));
    useWorkbenchStore.getState().setLayout({ sidebarWidth: 350 });
    await vi.advanceTimersByTimeAsync(500);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe('warning');
    expect(toasts[0].message).toBe('布局配置保存失败，本次更改在重启后可能丢失。');
    expect(SAVE_ERROR_MESSAGE).toBe('布局配置保存失败，本次更改在重启后可能丢失。');
  });

  it('MRU 变更（命令执行）进入防抖落盘', async () => {
    await initPersistence();
    mockSave.mockClear();
    record('view.command-palette');
    await vi.advanceTimersByTimeAsync(500);
    expect(mockSave).toHaveBeenCalledTimes(1);
    const payload = mockSave.mock.calls[0][0] as { commandMru: string[] };
    expect(payload.commandMru).toContain('view.command-palette');
  });

  it('hydrate 本身不触发写盘（订阅在应用之后建立）', async () => {
    mockLoad.mockResolvedValue(FILE_SETTINGS);
    await initPersistence();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('写盘内容经 validateSettings 再过一遍（内存异常值被钳制）', async () => {
    await initPersistence();
    mockSave.mockClear();
    useWorkbenchStore.getState().setLayout({ sidebarWidth: 9999 });
    await vi.advanceTimersByTimeAsync(500);
    const payload = mockSave.mock.calls[0][0] as {
      layouts: Record<string, { sidebarWidth: number }>;
    };
    expect(payload.layouts.standard.sidebarWidth).toBe(480);
  });
});
