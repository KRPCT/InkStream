/**
 * 命令 MRU（D-07）：上限 10，纯内存。
 * 跨会话持久化（settings.json commandMru）与启动 hydrate 属 Plan 06。
 */

const LIMIT = 10;

let ids: string[] = [];

/** 头插并去重提升；超过上限裁断。 */
export function record(id: string): void {
  ids = [id, ...ids.filter((x) => x !== id)].slice(0, LIMIT);
}

/** 返回副本，MRU 序（最近执行在前）。 */
export function list(): string[] {
  return [...ids];
}

/** 整体载入（Plan 06 启动时从 settings.json 恢复）。 */
export function hydrate(next: string[]): void {
  ids = next.slice(0, LIMIT);
}
