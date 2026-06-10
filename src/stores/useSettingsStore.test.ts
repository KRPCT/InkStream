import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setSystemColorScheme } from '../test/setup';
import type { ResolvedTheme } from '../types/settings';

// 隔离单元：mock ipc/theme，提供可手动触发的系统主题事件源
const listeners = new Set<(t: ResolvedTheme) => void>();
vi.mock('../ipc/theme', () => ({
  subscribeSystemTheme: vi.fn((cb: (t: ResolvedTheme) => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }),
}));

const { useSettingsStore, initSettingsFromDocument } = await import('./useSettingsStore');

function emitSystemTheme(t: ResolvedTheme): void {
  listeners.forEach((cb) => cb(t));
}

function mirror(): { theme?: string; mode?: string } {
  return JSON.parse(localStorage.getItem('inkstream.boot') ?? '{}');
}

beforeEach(() => {
  listeners.clear();
  localStorage.clear();
  setSystemColorScheme('light');
  document.documentElement.dataset.theme = 'light';
  useSettingsStore.setState({ theme: 'system', resolvedTheme: 'light' });
});

describe('useSettingsStore.setTheme', () => {
  it("setTheme('dark')：data-theme 与镜像同步写入", () => {
    useSettingsStore.getState().setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(useSettingsStore.getState().resolvedTheme).toBe('dark');
    expect(mirror().theme).toBe('dark');
  });

  it('镜像 merge：不覆盖已有 mode 字段', () => {
    localStorage.setItem('inkstream.boot', JSON.stringify({ mode: 'academic' }));
    useSettingsStore.getState().setTheme('dark');
    expect(mirror()).toEqual({ mode: 'academic', theme: 'dark' });
  });

  it("setTheme('system') + 系统为暗色：resolvedTheme 解析为 dark", () => {
    setSystemColorScheme('dark');
    useSettingsStore.getState().setTheme('system');
    expect(useSettingsStore.getState().resolvedTheme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(mirror().theme).toBe('system');
  });

  it('system 态下系统主题事件驱动 data-theme 跟随翻转', () => {
    useSettingsStore.getState().setTheme('system');
    emitSystemTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(useSettingsStore.getState().resolvedTheme).toBe('dark');
    emitSystemTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it("setTheme('light') 后系统事件不再影响 data-theme（订阅已取消）", () => {
    useSettingsStore.getState().setTheme('system');
    useSettingsStore.getState().setTheme('light');
    emitSystemTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(useSettingsStore.getState().resolvedTheme).toBe('light');
  });
});

describe('initSettingsFromDocument', () => {
  it('以 boot.js 已设的 data-theme 与镜像 theme 初始化，system 时接管订阅', () => {
    document.documentElement.dataset.theme = 'dark';
    localStorage.setItem('inkstream.boot', JSON.stringify({ theme: 'system' }));
    initSettingsFromDocument();
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(useSettingsStore.getState().resolvedTheme).toBe('dark');
    expect(listeners.size).toBe(1);
  });

  it('镜像缺失或异常值落默认 system，且锁定主题时不订阅', () => {
    localStorage.setItem('inkstream.boot', JSON.stringify({ theme: 'neon' }));
    initSettingsFromDocument();
    expect(useSettingsStore.getState().theme).toBe('system');

    listeners.clear();
    localStorage.setItem('inkstream.boot', JSON.stringify({ theme: 'light' }));
    initSettingsFromDocument();
    expect(useSettingsStore.getState().theme).toBe('light');
    expect(listeners.size).toBe(0);
  });
});
