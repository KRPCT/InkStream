import type { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** TypstWidget 回归门（Phase 5 W3）。typstClient 经 mock 控制就绪态/缓存，避免真 Worker + wasm。 */

let ready = false;
const cache = new Map<string, string>();
const ensureTypst = vi.fn();
const requestCompile = vi.fn();
const ERROR_SENTINEL = ' typst-error';
vi.mock('../typst/typstClient', () => ({
  ERROR_SENTINEL,
  typstReady: () => ready,
  getCachedSvg: (s: string) => cache.get(s) ?? null,
  ensureTypst: (v: unknown) => ensureTypst(v),
  requestCompile: (v: unknown, k: string, s: string) => requestCompile(v, k, s),
}));

const { TypstWidget } = await import('./TypstWidget');
const fakeView = {} as EditorView;

beforeEach(() => {
  ready = false;
  cache.clear();
  ensureTypst.mockClear();
  requestCompile.mockClear();
});

describe('TypstWidget', () => {
  it('eq 含 source + svg + ready 三态', () => {
    expect(new TypstWidget('a', 0, 50).eq(new TypstWidget('a', 0, 50))).toBe(true);
    expect(new TypstWidget('a', 0, 50).eq(new TypstWidget('b', 0, 50))).toBe(false);
  });

  it('未编译 + Worker 未就绪 → 加载占位 + 懒建 Worker', () => {
    ready = false;
    const dom = new TypstWidget('= 标题', 5, 50).toDOM(fakeView);
    expect(dom.classList.contains('cm-ink-typst-loading')).toBe(true);
    expect(ensureTypst).toHaveBeenCalledOnce();
    expect(requestCompile).not.toHaveBeenCalled();
  });

  it('未编译 + Worker 就绪 → 编译中占位 + requestCompile(blockKey)', () => {
    ready = true;
    const dom = new TypstWidget('= 标题', 5, 50).toDOM(fakeView);
    expect(dom.classList.contains('cm-ink-typst-loading')).toBe(true);
    expect(requestCompile).toHaveBeenCalledWith(fakeView, '5', '= 标题');
  });

  it('缓存命中 SVG → DOMParser 安全注入 <svg>', () => {
    cache.set('= 标题', '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    const dom = new TypstWidget('= 标题', 0, 50).toDOM(fakeView);
    expect(dom.querySelector('.cm-ink-typst-render svg')).not.toBeNull();
  });

  it('编译失败哨兵 → 错误占位（不再请求）', () => {
    cache.set('bad', ERROR_SENTINEL);
    const dom = new TypstWidget('bad', 0, 50).toDOM(fakeView);
    expect(dom.classList.contains('cm-ink-typst-error')).toBe(true);
    expect(requestCompile).not.toHaveBeenCalled();
  });

  it('空块 → 占位（不编译）', () => {
    const dom = new TypstWidget('   ', 0, 50).toDOM(fakeView);
    expect(dom.classList.contains('cm-ink-typst-empty')).toBe(true);
    expect(ensureTypst).not.toHaveBeenCalled();
  });
});
