import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageWidget, resolveVaultImage } from './ImageWidget';

/**
 * 图片内联预览 widget 回归门（EDIT-03 / D-09 / T-03-19）。
 *
 * 断言四件事：
 *   1. 远程 https: url → img.src 直接等于该 url（不经 convertFileSrc）；
 *   2. 本地 vault 内相对路径 → convertFileSrc 入参为 vault 内解析的绝对路径（安全边界下移调用点）；
 *   3. vault 越界路径（`../../secret`）→ 绝不调 convertFileSrc（T-03-19 path traversal 守门）；
 *   4. onerror 触发后 DOM 含「无法加载图片」失败态 + --color-error 描边 class；eq 按 url 复用。
 *
 * assetUrl 经 ipc/asset 收口 convertFileSrc（ipc/ 是唯一接触 @tauri-apps/api 的目录）——单测经
 * vi.mock 桩 ipc/asset，仅验证「是否调用 + 入参」，不触达真实 Tauri 通道。
 */

const assetUrl = vi.fn((p: string) => `asset://localhost/${p}`);
vi.mock('../../../ipc/asset', () => ({
  assetUrl: (p: string) => assetUrl(p),
}));

// 统一 vault 上下文：vault 根 + 当前文档相对路径（图片相对该文档目录解析）。
const VAULT = { root: '/vault', docPath: 'notes/post.md' };

beforeEach(() => {
  assetUrl.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveVaultImage（vault 内路径解析 + 越界守门 T-03-19）', () => {
  it('远程 http(s) url 原样返回（remote 标记）', () => {
    expect(resolveVaultImage('https://x.com/a.png', VAULT)).toEqual({
      kind: 'remote',
      url: 'https://x.com/a.png',
    });
    expect(resolveVaultImage('http://x.com/a.png', VAULT)).toEqual({
      kind: 'remote',
      url: 'http://x.com/a.png',
    });
  });

  it('本地相对路径解析为 vault 内绝对路径（local 标记）', () => {
    // notes/post.md 同目录的 img.png → /vault/notes/img.png
    expect(resolveVaultImage('img.png', VAULT)).toEqual({
      kind: 'local',
      absPath: '/vault/notes/img.png',
    });
    // 上跳一级到 vault 根仍在界内 → /vault/assets/img.png
    expect(resolveVaultImage('../assets/img.png', VAULT)).toEqual({
      kind: 'local',
      absPath: '/vault/assets/img.png',
    });
  });

  it('越 vault 根的路径标记为 invalid（绝不解析，T-03-19）', () => {
    expect(resolveVaultImage('../../secret', VAULT).kind).toBe('invalid');
    expect(resolveVaultImage('../../../etc/passwd', VAULT).kind).toBe('invalid');
  });

  it('绝对/协议路径（file:// / 绝对盘符）不当作 vault 内本地图（invalid）', () => {
    expect(resolveVaultImage('file:///etc/passwd', VAULT).kind).toBe('invalid');
    expect(resolveVaultImage('/etc/passwd', VAULT).kind).toBe('invalid');
  });

  it('Windows 反斜杠相对路径越界 → invalid（WR-01 path traversal 守门）', () => {
    // `..\..\secret.png` 无前导斜杠/scheme，过 line-52 守门；反斜杠须当分隔符折叠才能识破上跳。
    expect(resolveVaultImage('..\\..\\secret.png', VAULT).kind).toBe('invalid');
    // 混合分隔符上跳越界同样拒绝。
    expect(resolveVaultImage('sub\\..\\..\\..\\x.png', VAULT).kind).toBe('invalid');
  });

  it('反斜杠分隔的界内相对路径仍解析为 vault 内绝对路径（local）', () => {
    // notes/post.md 同目录 sub\img.png → /vault/notes/sub/img.png（反斜杠当 POSIX `/` 段折叠）。
    expect(resolveVaultImage('sub\\img.png', VAULT)).toEqual({
      kind: 'local',
      absPath: '/vault/notes/sub/img.png',
    });
  });

  it('无 vault 上下文时本地路径不解析（invalid）', () => {
    expect(resolveVaultImage('img.png', null).kind).toBe('invalid');
  });

  it('Windows verbatim 根（\\\\?\\D:\\vault）规范化为正斜杠绝对路径，asset 协议可解析（UAT 图片）', () => {
    // open_vault 在 Windows 返回 canonicalize 的 verbatim 路径（反斜杠 + `\\?\` 前缀）。
    // POSIX `/vault` fixture 抓不到此回归——须用真实 Windows 根。
    expect(
      resolveVaultImage('img.png', { root: '\\\\?\\D:\\vault', docPath: 'notes/post.md' }),
    ).toEqual({ kind: 'local', absPath: 'D:/vault/notes/img.png' });
    // UNC verbatim 根同样规范化。
    expect(
      resolveVaultImage('img.png', { root: '\\\\?\\UNC\\server\\share\\vault', docPath: 'post.md' }),
    ).toEqual({ kind: 'local', absPath: '//server/share/vault/img.png' });
  });
});

describe('ImageWidget.toDOM', () => {
  it('远程 https: → img.src 等于该 url，不调 convertFileSrc', () => {
    const widget = new ImageWidget('https://x.com/a.png', VAULT);
    const dom = widget.toDOM();
    const img = dom.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('https://x.com/a.png');
    expect(img!.getAttribute('loading')).toBe('lazy');
    expect(assetUrl).not.toHaveBeenCalled();
  });

  it('本地 vault 内路径 → convertFileSrc 入参为 vault 内绝对路径', () => {
    const widget = new ImageWidget('img.png', VAULT);
    widget.toDOM();
    expect(assetUrl).toHaveBeenCalledTimes(1);
    expect(assetUrl).toHaveBeenCalledWith('/vault/notes/img.png');
  });

  it('vault 越界路径（../../secret）→ 不调 convertFileSrc，渲染失败占位', () => {
    const widget = new ImageWidget('../../secret', VAULT);
    const dom = widget.toDOM();
    expect(assetUrl).not.toHaveBeenCalled();
    expect(dom.textContent).toContain('无法加载图片');
    expect(dom.classList.contains('cm-ink-image-error')).toBe(true);
  });

  it('onerror 触发后 DOM 含「无法加载图片」+ --color-error 描边 class', () => {
    const widget = new ImageWidget('https://x.com/broken.png', VAULT);
    const dom = widget.toDOM();
    const img = dom.querySelector('img')!;
    img.dispatchEvent(new Event('error'));
    expect(dom.textContent).toContain('无法加载图片');
    expect(dom.classList.contains('cm-ink-image-error')).toBe(true);
  });

  it('onload 触发后移除加载占位态', () => {
    const widget = new ImageWidget('https://x.com/a.png', VAULT);
    const dom = widget.toDOM();
    expect(dom.classList.contains('cm-ink-image-loading')).toBe(true);
    dom.querySelector('img')!.dispatchEvent(new Event('load'));
    expect(dom.classList.contains('cm-ink-image-loading')).toBe(false);
  });

  it('eq 按 url 比较（同 url true / 异 url false）', () => {
    const a = new ImageWidget('img.png', VAULT);
    const b = new ImageWidget('img.png', VAULT);
    const c = new ImageWidget('other.png', VAULT);
    expect(a.eq(b)).toBe(true);
    expect(a.eq(c)).toBe(false);
  });
});
