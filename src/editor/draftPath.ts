/**
 * 未命名草稿 path 方案（纯逻辑叶子模块，零依赖）。
 *
 * 草稿是纯内存文档：path 用合成标识 `draft://N`（N 会话内递增），**永不落盘到该 path**。
 * 守卫集中于 isDraftPath：autosave 跳过落盘、Ctrl+S 走另存为转正（draftFlow.saveDraftAs）、
 * 关 tab 走丢弃确认（EditorTabs）。草稿不进 watcher、不持久化。
 */

const DRAFT_PREFIX = 'draft://';

let counter = 0;

/** 是否为草稿合成 path（draft:// 前缀）。 */
export function isDraftPath(path: string): boolean {
  return path.startsWith(DRAFT_PREFIX);
}

/** 分配下一个草稿 tab：path `draft://N` + 显示名「未命名-N」。 */
export function nextDraft(): { path: string; name: string } {
  counter += 1;
  return { path: `${DRAFT_PREFIX}${counter}`, name: `未命名-${counter}` };
}

/** 仅供测试：复位计数器以隔离用例。 */
export function __resetDraftCounterForTest(): void {
  counter = 0;
}
