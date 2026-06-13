import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { destroyTestView, makeTestView } from '../../test/composition';
import { extensionsForLanguage } from '../languages';

/**
 * 链接跳转手势回归门（D-10 / RESEARCH「链接手势」/ 威胁 T-03-16）三路分流。
 *
 * 断言：
 *   1. Ctrl/Cmd+mousedown 命中外链 `http(s)` → preventDefault + openExternal(url) + return true；
 *   2. Ctrl/Cmd+mousedown 命中相对 `note.md` → openFileByPath(vault 解析后相对路径) + return true；
 *   3. Ctrl/Cmd+mousedown 命中越界相对（`../` 越过 vault 根）→ 既不 openExternal 也不 openFileByPath，return false；
 *   4. 普通 mousedown 命中链接 → 都不调，return false（CM 默认置光标，该行显源码）；
 *   5. 非链接位置 / 坐标未命中 → 都不调，return false；
 *   6. 源纪律：经 openExternal（http(s) 守门）+ openFileByPath（相对）、读 metaKey||ctrlKey 分流、wiki-link Phase-4 注释。
 *
 * openExternal / openFileByPath 经 vi.mock 替身：断言「是否被调 + 调用参数」；scheme 守门由 opener.test.ts、
 * vault 边界折叠由 resolveVaultRelative 单测覆盖。
 */

const openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
vi.mock('../../ipc/opener', () => ({
  openExternal: (url: string) => openExternal(url),
}));

const openFileByPath = vi.fn<(path: string) => Promise<void>>(() => Promise.resolve());
vi.mock('../fileOpenFlow', () => ({
  openFileByPath: (path: string) => openFileByPath(path),
}));

// 活动文档相对路径替身：相对链接据此目录折叠解析（默认 notes/doc.md，目录为 notes/）。
let activePath: string | null = 'notes/doc.md';
vi.mock('../../stores/useEditorStore', () => ({
  useEditorStore: { getState: () => ({ activePath }) },
}));

// W3 wiki-link 跳转替身：createFile / refreshTree / showToast / vault 文件清单。
const createFile = vi.fn<(root: string, path: string) => Promise<null>>(() => Promise.resolve(null));
vi.mock('../../ipc/files', () => ({ createFile: (root: string, path: string) => createFile(root, path) }));
const refreshTree = vi.fn(() => Promise.resolve());
vi.mock('../fileTreeData', () => ({ refreshTree: () => refreshTree() }));
const showToast = vi.fn();
vi.mock('../../stores/useToastStore', () => ({ showToast: (...a: unknown[]) => showToast(...a) }));
let vaultFiles: Array<{ name: string; path: string }> = [];
vi.mock('../../stores/useVaultStore', () => ({
  useVaultStore: {
    getState: () => ({ vault: { root: '/v', repoRoot: null, name: 'v' }, files: vaultFiles }),
  },
}));

// mock 后再引入被测件（确保闭包到的是替身）。
const { handleLinkMousedown, resolveVaultRelative } = await import('./linkGesture');

let view: EditorView | null = null;

afterEach(() => {
  destroyTestView(view);
  view = null;
});

beforeEach(() => {
  openExternal.mockClear();
  openFileByPath.mockClear();
  createFile.mockClear();
  refreshTree.mockClear();
  showToast.mockClear();
  vaultFiles = [];
  activePath = 'notes/doc.md';
});

/** 用 markdown(GFM) 构建 view。 */
function mdView(doc: string): EditorView {
  return makeTestView(doc, [extensionsForLanguage('markdown')]);
}

/** Ctrl+mousedown 事件替身（posAtCoords 另行桩）。 */
function ctrlDown(): MouseEvent {
  return {
    clientX: 0,
    clientY: 0,
    ctrlKey: true,
    metaKey: false,
    preventDefault: () => {},
  } as unknown as MouseEvent;
}

describe('handleLinkMousedown wiki-link 跳转（Phase 4 W3 / LINK-03）', () => {
  it('Ctrl+点击 [[english]] → 解析并 openFileByPath(english.md)', () => {
    vaultFiles = [{ name: 'english.md', path: 'english.md' }];
    view = mdView('[[english]]');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 4 });
    expect(handleLinkMousedown(ctrlDown(), view)).toBe(true);
    expect(openFileByPath).toHaveBeenCalledWith('english.md');
    expect(createFile).not.toHaveBeenCalled();
  });

  it('Ctrl+点击 [[a|别名]] → 用 target a 跳转（非别名）', () => {
    vaultFiles = [{ name: 'a.md', path: 'a.md' }];
    view = mdView('[[a|别名]]');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 5 }); // 落别名内
    handleLinkMousedown(ctrlDown(), view);
    expect(openFileByPath).toHaveBeenCalledWith('a.md');
  });

  it('Ctrl+点击不存在目标 → createFile + 打开 + 提示', async () => {
    view = mdView('[[新页]]');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 3 });
    handleLinkMousedown(ctrlDown(), view);
    expect(createFile).toHaveBeenCalledWith('/v', '新页.md');
    await Promise.resolve();
    await Promise.resolve();
    expect(openFileByPath).toHaveBeenCalledWith('新页.md');
    expect(showToast).toHaveBeenCalled();
  });

  it('普通点击（无 Ctrl）命中 wiki-link → 不跳转 return false', () => {
    vaultFiles = [{ name: 'english.md', path: 'english.md' }];
    view = mdView('[[english]]');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 4 });
    const ev = { clientX: 0, clientY: 0, ctrlKey: false, metaKey: false, preventDefault() {} } as unknown as MouseEvent;
    expect(handleLinkMousedown(ev, view)).toBe(false);
    expect(openFileByPath).not.toHaveBeenCalled();
  });
});

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
    // 外链路绝不误走相对打开。
    expect(openFileByPath).not.toHaveBeenCalled();
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

describe('handleLinkMousedown 相对链接 → vault 内单内核打开（路 2）', () => {
  it('Ctrl+点击相对 `note.md` → openFileByPath(同目录解析路径) + preventDefault + return true，不调 openExternal', () => {
    // 活动文档 notes/doc.md（目录 notes/），相对链接 note.md 解析为 notes/note.md。
    view = mdView('[t](note.md)');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 1 });
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

    expect(handleLinkMousedown(event, view)).toBe(true);
    expect(prevented).toBe(true);
    expect(openFileByPath).toHaveBeenCalledTimes(1);
    expect(openFileByPath).toHaveBeenCalledWith('notes/note.md');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('Ctrl+点击 `../shared/x.md` → 据目录上跳解析为 shared/x.md（仍在 vault 内）', () => {
    activePath = 'notes/doc.md';
    view = mdView('[t](../shared/x.md)');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 1 });
    const event = {
      clientX: 0,
      clientY: 0,
      ctrlKey: true,
      metaKey: false,
      preventDefault: () => {},
    } as unknown as MouseEvent;

    expect(handleLinkMousedown(event, view)).toBe(true);
    expect(openFileByPath).toHaveBeenCalledWith('shared/x.md');
  });

  it('越界相对（`../../secret.md` 上跳越过 vault 根）→ 既不 openFileByPath 也不 openExternal，return false', () => {
    activePath = 'notes/doc.md'; // 目录 notes/ 只 1 段，`../..` 第二跳越根。
    view = mdView('[t](../../secret.md)');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 1 });
    const event = {
      clientX: 0,
      clientY: 0,
      ctrlKey: true,
      metaKey: false,
      preventDefault: () => {},
    } as unknown as MouseEvent;

    expect(handleLinkMousedown(event, view)).toBe(false);
    expect(openFileByPath).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('绝对路径 `/etc/passwd` → 不 openFileByPath（绝对路径非 vault 相对），return false', () => {
    view = mdView('[t](/etc/passwd)');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 1 });
    const event = {
      clientX: 0,
      clientY: 0,
      ctrlKey: true,
      metaKey: false,
      preventDefault: () => {},
    } as unknown as MouseEvent;

    expect(handleLinkMousedown(event, view)).toBe(false);
    expect(openFileByPath).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('普通（无修饰键）点击相对链接 → return false（CM 置光标），不 openFileByPath', () => {
    view = mdView('[t](note.md)');
    Object.defineProperty(view, 'posAtCoords', { configurable: true, value: () => 1 });
    const event = {
      clientX: 0,
      clientY: 0,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => {},
    } as unknown as MouseEvent;

    expect(handleLinkMousedown(event, view)).toBe(false);
    expect(openFileByPath).not.toHaveBeenCalled();
  });
});

describe('resolveVaultRelative 折叠纯函数（vault 边界收口，T-03-19 同源）', () => {
  it('同目录相对 → 拼活动文档目录', () => {
    expect(resolveVaultRelative('note.md', 'notes/doc.md')).toBe('notes/note.md');
  });

  it('`./` 当前目录前缀被折叠', () => {
    expect(resolveVaultRelative('./a/b.md', 'notes/doc.md')).toBe('notes/a/b.md');
  });

  it('`../` 上跳一级仍在 vault 内', () => {
    expect(resolveVaultRelative('../shared/x.md', 'notes/doc.md')).toBe('shared/x.md');
  });

  it('根目录文档的相对链接（无目录段）拼到根', () => {
    expect(resolveVaultRelative('a.md', 'doc.md')).toBe('a.md');
  });

  it('上跳越过 vault 根 → null（越界拒绝）', () => {
    expect(resolveVaultRelative('../../secret.md', 'notes/doc.md')).toBeNull();
  });

  it('绝对路径 / 含 scheme → null（非 vault 相对）', () => {
    expect(resolveVaultRelative('/abs/x.md', 'notes/doc.md')).toBeNull();
    expect(resolveVaultRelative('\\abs\\x.md', 'notes/doc.md')).toBeNull();
    expect(resolveVaultRelative('file:///etc/passwd', 'notes/doc.md')).toBeNull();
  });

  it('无活动文档 → null', () => {
    expect(resolveVaultRelative('note.md', null)).toBeNull();
  });
});

describe('linkGesture 源纪律', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'src/editor/livepreview/linkGesture.ts'),
    'utf8',
  );

  it('外链经 openExternal（Plan 02 http(s) 窄权限通道）', () => {
    expect(src).toContain('openExternal');
  });

  it('相对链接经 openFileByPath（单内核打开，vault 内）', () => {
    expect(src).toContain('openFileByPath');
  });

  it('读 metaKey || ctrlKey 分流', () => {
    expect(src).toMatch(/metaKey\s*\|\|\s*.*ctrlKey|ctrlKey\s*\|\|\s*.*metaKey/);
  });

  it('导出 linkGesture（domEventHandlers 扩展）', () => {
    expect(src).toMatch(/export const linkGesture/);
    expect(src).toContain('domEventHandlers');
  });

  it('含 wiki-link Phase-4 注释（复用本手势分流骨架，本阶段不处理）', () => {
    expect(src).toMatch(/wiki-link/i);
    expect(src).toMatch(/Phase 4|Phase-4/);
  });
});
