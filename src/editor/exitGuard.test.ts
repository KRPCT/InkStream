import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitStatus } from '../types/git';

// onCloseRequested 回调只用到 event.preventDefault——本地最小类型，避免越过 ipc/ 直接 import Tauri 类型（项目立约）。
type CloseEvent = { preventDefault: () => void };

// 捕获 onCloseRequested 注册的回调供手动触发；mock 掉真实 Tauri 窗口与确认对话框。
let closeCb: ((e: CloseEvent) => void | Promise<void>) | null = null;
const destroy = vi.fn();
vi.mock('../ipc/window', () => ({
  windowControls: {
    onCloseRequested: (cb: (e: CloseEvent) => void | Promise<void>) => {
      closeCb = cb;
      return Promise.resolve(() => {
        closeCb = null;
      });
    },
    destroy: () => {
      destroy();
      return Promise.resolve();
    },
  },
}));

const confirmSpy = vi.fn<(opts: { title: string; body: string; confirmLabel: string }) => Promise<boolean>>();
vi.mock('../stores/useConfirmStore', () => ({
  confirmDestructive: (opts: { title: string; body: string; confirmLabel: string }) => confirmSpy(opts),
}));

import { initExitGuard, stopExitGuard } from './exitGuard';
import { useEditorStore } from '../stores/useEditorStore';
import { useGitStore } from '../stores/useGitStore';
import { useSettingsStore } from '../stores/useSettingsStore';

function gitStatus(n: number): GitStatus {
  return {
    branch: 'main',
    files: Array.from({ length: n }, (_, i) => ({
      path: `f${i}.md`,
      staged: false,
      unstaged: true,
      status: 'modified' as const,
    })),
  };
}

/** 触发一次关窗请求，返回带 spy 的事件以断言是否被拦截。 */
async function fireClose(): Promise<{ preventDefault: ReturnType<typeof vi.fn> }> {
  const event = { preventDefault: vi.fn() };
  await closeCb!(event);
  return event;
}

beforeEach(() => {
  closeCb = null;
  destroy.mockReset();
  confirmSpy.mockReset().mockResolvedValue(true);
  useEditorStore.setState({ dirty: {} });
  useGitStore.setState({ repoRoot: null, status: null });
  useSettingsStore.setState({ simpleMode: false });
  initExitGuard();
});
afterEach(() => stopExitGuard());

describe('exitGuard', () => {
  it('简易模式：有未提交 git 改动也不弹 git 提醒（git 已关）', async () => {
    useSettingsStore.setState({ simpleMode: true });
    useGitStore.setState({ repoRoot: '/repo', status: gitStatus(3) });
    const e = await fireClose();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('简易模式：有未保存文档则弹未保存提醒并放行退出', async () => {
    useSettingsStore.setState({ simpleMode: true });
    useEditorStore.setState({ dirty: { 'a.md': true, 'b.md': false } });
    const e = await fireClose();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: '有未保存的更改', body: expect.stringContaining('1 个文档') }),
    );
    expect(destroy).toHaveBeenCalled();
  });

  it('完整模式：无未保存但有未提交 → 弹 git 提醒', async () => {
    useGitStore.setState({ repoRoot: '/repo', status: gitStatus(2) });
    await fireClose();
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: '有未提交的更改', body: expect.stringContaining('2 个文件') }),
    );
  });

  it('完整模式：未保存优先于未提交（只弹一次未保存）', async () => {
    useEditorStore.setState({ dirty: { 'a.md': true } });
    useGitStore.setState({ repoRoot: '/repo', status: gitStatus(2) });
    await fireClose();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(expect.objectContaining({ title: '有未保存的更改' }));
  });

  it('无未保存、无未提交：不拦，正常关闭', async () => {
    const e = await fireClose();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('取消退出则不 destroy', async () => {
    confirmSpy.mockResolvedValue(false);
    useEditorStore.setState({ dirty: { 'a.md': true } });
    const e = await fireClose();
    expect(e.preventDefault).toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });
});
