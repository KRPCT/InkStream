import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { openExternal } from '../../ipc/opener';

/**
 * 链接跳转手势（D-10 / RESEARCH「链接手势」/ 威胁 T-03-16）。
 *
 * 分流（mousedown 层，非语法树职责）：
 *   - Ctrl/Cmd+点击命中链接 → preventDefault + openExternal(url)，return true（纯导航，不改选区）；
 *   - 普通点击命中链接 → return false（CM 默认置光标，该行显源码进编辑 D-10）；
 *   - 非链接位置 / 坐标未命中 → return false（交回 CM 默认行为）。
 *
 * 外链安全：URL 一律经 openExternal（Plan 02），其内 scheme allowlist 仅放行 http(s)，
 * `[text](javascript:...)` / `data:` / `file:` 静默不打开（T-03-16 缓解，scheme 守门由 opener.test 覆盖）。
 *
 * 前向兼容（RESEARCH 扩展点 4）：Phase 4 wiki-link 跳转复用本手势分流骨架（mousedown 读修饰键）。
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

/**
 * mousedown 手势分流核心（纯逻辑，配对单测穷举：Ctrl/Cmd 命中、普通命中、非链接、坐标未命中）。
 *
 * @returns true = 已处理（导航，CM 不再默认置光标）；false = 交回 CM 默认行为。
 */
export function handleLinkMousedown(event: MouseEvent, view: EditorView): boolean {
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return false;

  const link = findLinkNode(view.state, pos);
  if (!link) return false;

  // 仅 Ctrl/Cmd+点击触发跳转；普通点击交回 CM 默认（置光标进编辑该行显源码）。
  if (!(event.metaKey || event.ctrlKey)) return false;

  const url = extractUrl(view.state, link);
  if (url == null) return false;

  event.preventDefault(); // 纯导航：不夺焦点 / 不改选区。
  void openExternal(url); // Plan 02 窄权限通道，scheme 非 http(s) 内部静默拦截。
  return true;
}

/**
 * 链接手势扩展（挂入 livePreviewExtensions）：mousedown domEventHandler 委派 handleLinkMousedown。
 *
 * 返回 true 时 CM6 跳过默认 mousedown 处理（不置光标）；false 时按默认走（置光标）。
 */
export const linkGesture = EditorView.domEventHandlers({
  mousedown: (event, view) => handleLinkMousedown(event, view),
});
