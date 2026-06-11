import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';

/**
 * 链接跳转手势回归门（D-10 / RESEARCH「链接手势」/ 威胁 T-03-16）。
 *
 * 断言：
 *   1. Ctrl/Cmd+mousedown 命中链接 → preventDefault + openExternal(链接 url) + return true（纯导航）；
 *   2. 普通 mousedown 命中链接 → 不调 openExternal 且 return false（CM 默认置光标，该行显源码）；
 *   3. 非链接位置 mousedown → 不调 openExternal 且 return false；
 *   4. 源纪律：经 openExternal（Plan 02 http(s) 守门）、读 metaKey||ctrlKey 分流。
 *
 * openExternal 经 vi.mock 替身：断言「是否被调 + 调用参数」，scheme 守门由 opener.test.ts 覆盖。
 */

const openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
vi.mock('../../ipc/opener', () => ({
  openExternal: (url: string) => openExternal(url),
}));

// mock 后再引入被测件（确保 handleLinkMousedown 闭包到的是替身）。
const { handleLinkMousedown } = await import('./linkGesture');

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

beforeEach(() => {
  openExternal.mockClear();
});

/** 用 markdown(GFM) 构建 view。 */
function mdView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown')]);
}

describe('handleLinkMousedown 手势分流（D-10）', () => {
  it('Ctrl+mousedown 命中链接 → openExternal(url) + preventDefault + return true', () => {
    view = mdView('[text](https://x.com)');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 2 });
    let prevented = false;
    const event = {
      clientX: 0,
      clientY: 0,
      ctrlKey: true,
      metaKey: false,
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as MouseEvent;

    const handled = handleLinkMousedown(event, view);

    expect(handled).toBe(true);
    expect(prevented).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://x.com');
  });

  it('Cmd(meta)+mousedown 命中链接 → openExternal(url)', () => {
    view = mdView('[text](https://y.com)');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 2 });
    const event = {
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      metaKey: true,
      preventDefault: () => {},
    } as unknown as MouseEvent;

    expect(handleLinkMousedown(event, view)).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://y.com');
  });

  it('普通 mousedown 命中链接 → 不调 openExternal 且 return false（CM 默认置光标）', () => {
    view = mdView('[text](https://x.com)');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 2 });
    const event = {
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => {},
    } as unknown as MouseEvent;

    expect(handleLinkMousedown(event, view)).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('Ctrl+mousedown 非链接位置 → 不调 openExternal 且 return false', () => {
    view = mdView('plain text');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 3 });
    const event = {
      clientX: 0,
      clientY: 0,
      ctrlKey: true,
      metaKey: false,
      preventDefault: () => {},
    } as unknown as MouseEvent;

    expect(handleLinkMousedown(event, view)).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('posAtCoords 返回 null（坐标未命中文档）→ return false', () => {
    view = mdView('[text](https://x.com)');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => null });
    const event = {
      clientX: 0,
      clientY: 0,
      ctrlKey: true,
      metaKey: false,
      preventDefault: () => {},
    } as unknown as MouseEvent;

    expect(handleLinkMousedown(event, view)).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('linkGesture 源纪律', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/editor/livepreview/linkGesture.ts'),
    'utf8',
  );

  it('经 openExternal（Plan 02 http(s) 窄权限通道）', () => {
    expect(src).toContain('openExternal');
  });

  it('读 metaKey || ctrlKey 分流', () => {
    expect(src).toMatch(/metaKey\s*\|\|\s*.*ctrlKey|ctrlKey\s*\|\|\s*.*metaKey/);
  });

  it('导出 linkGesture（domEventHandlers 扩展）', () => {
    expect(src).toMatch(/export const linkGesture/);
    expect(src).toContain('domEventHandlers');
  });
});
