import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// matchMedia mock（可配置 prefers-color-scheme 返回值，供主题测试切换系统色）
// ---------------------------------------------------------------------------

let systemColorScheme: 'light' | 'dark' = 'light';

/** 测试内调用以模拟系统亮暗色变化（影响 matchMedia('(prefers-color-scheme: dark)')） */
export function setSystemColorScheme(scheme: 'light' | 'dark'): void {
  systemColorScheme = scheme;
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    get matches() {
      return query.includes('prefers-color-scheme: dark') ? systemColorScheme === 'dark' : false;
    },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ---------------------------------------------------------------------------
// Tauri API 默认 mock 工厂：所有组件/单元测试不依赖真 Tauri runtime
// ---------------------------------------------------------------------------

const mockWindow = {
  minimize: vi.fn().mockResolvedValue(undefined),
  toggleMaximize: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  show: vi.fn().mockResolvedValue(undefined),
  theme: vi.fn().mockResolvedValue('light'),
  onThemeChanged: vi.fn().mockResolvedValue(() => {}),
};

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => mockWindow),
}));

class MockChannel {
  onmessage: ((response: unknown) => void) | null = null;
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  Channel: MockChannel,
}));
