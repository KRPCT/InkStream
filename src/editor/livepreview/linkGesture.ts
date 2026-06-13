import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { openExternal } from '../../ipc/opener';
import { createFile } from '../../ipc/files';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { showToast } from '../../stores/useToastStore';
import { openFileByPath } from '../fileOpenFlow';
import { refreshTree } from '../fileTreeData';
import { WIKI_LINK_NODE, WIKI_LINK_TARGET } from './nodeNames';
import { resolveWikiTarget, wikiTargetPath, wikiTargetToCreatePath } from './wikiTarget';

/**
 * 链接跳转手势（D-10 / RESEARCH「链接手势」/ 威胁 T-03-16）三路分流。
 *
 * 分流（mousedown 层，非语法树职责）——Ctrl/Cmd+点击命中链接，据 URL 形态走三路：
 *   1. 外链 `^https?://` → openExternal(url)（Plan 02 http(s) 窄权限通道），return true（纯导航）；
 *   2. vault 内相对路径（无 scheme、非绝对路径）→ 据**活动文档目录**折叠解析为 vault 相对路径，
 *      断言仍在 vault 内后 openFileByPath(resolvedRelPath)（单内核打开，fileOpenFlow），return true；
 *   3. 越界 / 无法解析（`../` 上跳越过 vault 根、绝对路径、含 scheme 的非 http(s)）→ 不动作，return false。
 *   - 普通点击（无修饰键）命中链接 → return false（CM 默认置光标，该行显源码进编辑 D-10）；
 *   - 非链接位置 / 坐标未命中 → return false（交回 CM 默认行为）。
 *
 * 安全（T-03-16 / RESEARCH Security V12）：
 *   - 外链一律经 openExternal——其内 scheme allowlist 仅放行 http(s)，`javascript:` / `data:` / `file:`
 *     静默不打开（scheme 守门由 opener.test 覆盖）；
 *   - 相对打开仅解析在 vault 根内的路径——上跳越界（`../../secret`）、绝对路径、含 scheme 的 url 一律
 *     不 openFileByPath（镜像 ImageWidget.resolveVaultImage 的 vault 边界收口纪律，T-03-19 同源）。
 *
 * Phase 4 W3（已落地）：`[[wiki-link]]` 内部跳转 + 缺失目标即建——Ctrl/Cmd+点击优先命中 WikiLink 节点，
 * 解析 WikiLinkTarget（剥 #heading/^block）经 wikiTarget.ts 解析为 vault 文件，命中即单内核打开，
 * 不存在则新建 `target.md` + 打开 + 刷新树 + 提示（Obsidian 风）。`[[` fuzzy 补全见 wikiLinkComplete.ts。
 */

/**
 * 从 pos 处向上找最近的 Link 节点；找不到返回 null。
 *
 * syntaxTree.resolve(pos) 落到最深节点（可能是 LinkMark/URL/链接内文本），
 * 经 parent 链上溯到 Link 容器（[text](url) 整节点）。
 */
function findLinkNode(state: EditorState, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolve(pos, -1);
  while (node) {
    if (node.name === 'Link') return node;
    node = node.parent;
  }
  return null;
}

/**
 * 取 Link 节点的 URL 子节点文本（`[text](url)` 的 url 部分）；无 URL 子节点返回 null。
 *
 * lezer 把 url 解析为 Link 下的 `URL` 子节点（实查 03-06 dump：`URL [7-20] "https://x.com"`）。
 */
function extractUrl(state: EditorState, link: SyntaxNode): string | null {
  const url = link.getChild('URL');
  if (!url) return null;
  return state.doc.sliceString(url.from, url.to);
}

/** 外链 scheme（经 openExternal 的 http(s) allowlist，与 opener.ts 同纪律）。 */
const HTTP_SCHEME = /^https?:\/\//i;

/**
 * 把 vault 内相对链接（如 `note.md` / `../sub/x.md`）据**活动文档目录**折叠解析为 vault 相对路径。
 *
 * 镜像 ImageWidget.resolveVaultImage 的段折叠 + vault 边界收口（T-03-19 同源纪律）：
 *   - 含 scheme（file:/data: 等）/ 绝对路径（`/` 或 `\` 起）/ 无活动文档 → null（不解析，交回 false）；
 *   - 以活动文档相对 vault 根的路径去文件名段为基准目录，逐段折叠 `.`/`..`；
 *   - `..` 上跳越过 vault 根（栈空再 pop）→ null（越界拒绝）。
 *
 * activePath 本就是 vault 相对路径（vaultFlow 的 node.id），故折叠结果即 vault 相对路径，
 * 直接喂 openFileByPath（其按相对路径在单内核打开）。空结果（解析到根本身）亦视为无效。
 */
export function resolveVaultRelative(url: string, activePath: string | null): string | null {
  // 含 scheme（非 http 已在调用点分流，此处含 file:/data: 等）或绝对路径：非 vault 内相对链接。
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') || url.startsWith('\\')) {
    return null;
  }
  if (!activePath) return null;

  // 活动文档所在目录（去掉文件名段）作为相对链接基准目录；反斜杠/正斜杠同视为分隔符。
  const baseSegments = activePath.split(/[\\/]/).filter(Boolean);
  baseSegments.pop(); // 去掉文档文件名，留目录段。

  const stack = [...baseSegments];
  for (const seg of url.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (stack.length === 0) return null; // 上跳越过 vault 根：越界拒绝。
      stack.pop();
      continue;
    }
    stack.push(seg);
  }
  if (stack.length === 0) return null; // 解析到 vault 根本身（非文件）：无效。
  return stack.join('/');
}

/** 取文件名末段（toast 用）。 */
function baseName(path: string): string {
  const segs = path.split('/');
  return segs[segs.length - 1] || path;
}

/** 从 pos 向上找最近的 WikiLink 节点（点渲染出的 alias/target 落其子节点，上溯到容器）；无则 null。 */
function findWikiLinkNode(state: EditorState, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolve(pos, -1);
  while (node) {
    if (node.name === WIKI_LINK_NODE) return node;
    node = node.parent;
  }
  return null;
}

/**
 * wiki-link 跳转（Phase 4 W3 / LINK-03）：解析 WikiLinkTarget 内核（剥 #heading/^block）→ vault 文件。
 * 命中即单内核打开；目标不存在 → 新建 `target.md` + 打开 + 刷新树 + 提示（Obsidian 风，点击即建）。
 */
async function navigateWikiLink(view: EditorView, wiki: SyntaxNode): Promise<void> {
  const targetNode = wiki.getChild(WIKI_LINK_TARGET);
  const path = wikiTargetPath(targetNode ? view.state.doc.sliceString(targetNode.from, targetNode.to) : '');
  if (!path) {
    showToast('warning', '无法解析该 wiki 链接的目标。');
    return;
  }
  const vault = useVaultStore.getState().vault;
  if (!vault) return;
  const resolved = resolveWikiTarget(path, useVaultStore.getState().files);
  if (resolved !== null) {
    void openFileByPath(resolved);
    return;
  }
  const rel = wikiTargetToCreatePath(path);
  try {
    await createFile(vault.root, rel);
    await openFileByPath(rel);
    void refreshTree();
    showToast('warning', `「${baseName(rel)}」不存在，已新建并打开。`);
  } catch {
    showToast('error', `无法新建「${baseName(rel)}」（目标目录可能不存在）。`);
  }
}

/**
 * mousedown 手势分流核心（纯逻辑，配对单测穷举：Ctrl/Cmd 外链、相对、越界、wiki-link、普通点击、未命中）。
 *
 * @returns true = 已处理（导航，CM 不再默认置光标）；false = 交回 CM 默认行为。
 */
export function handleLinkMousedown(event: MouseEvent, view: EditorView): boolean {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return false;

  // 仅 Ctrl/Cmd+点击触发跳转；普通点击交回 CM 默认（置光标进编辑该行显源码）。
  if (!(event.metaKey || event.ctrlKey)) return false;

  // wiki-link 跳转优先（Phase 4 W3）：命中 WikiLink → 解析 target 打开/新建。
  const wiki = findWikiLinkNode(view.state, pos);
  if (wiki) {
    event.preventDefault();
    void navigateWikiLink(view, wiki);
    return true;
  }

  const link = findLinkNode(view.state, pos);
  if (!link) return false;

  const url = extractUrl(view.state, link);
  if (url == null) return false;

  // 路 1：外链 http(s) → openExternal（Plan 02 窄权限通道，scheme 非 http(s) 内部静默拦截）。
  if (HTTP_SCHEME.test(url)) {
    event.preventDefault(); // 纯导航：不夺焦点 / 不改选区。
    void openExternal(url);
    return true;
  }

  // 路 2：vault 内相对路径 → 据活动文档目录折叠解析（断言在 vault 内）后单内核打开。
  const rel = resolveVaultRelative(url, useEditorStore.getState().activePath);
  if (rel !== null) {
    event.preventDefault();
    void openFileByPath(rel);
    return true;
  }

  // 路 3：越界 / 无法解析（绝对路径、上跳越界、含非 http scheme）→ 不动作（return false 交回 CM）。
  return false;
}

/**
 * 链接手势扩展（挂入 livePreviewExtensions）：mousedown domEventHandler 委派 handleLinkMousedown。
 *
 * 返回 true 时 CM6 跳过默认 mousedown 处理（不置光标）；false 时按默认走（置光标）。
 */
export const linkGesture = EditorView.domEventHandlers({
  mousedown: (event, view) => handleLinkMousedown(event, view),
});
