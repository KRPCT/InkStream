/**
 * 命令 MRU（D-07）：上限 10。
 * 跨会话持久化由 persistSettings 订阅 subscribe() 落盘（settings.json commandMru）。
 */

const LIMIT = 10;

let ids: string[] = [];
const subscribers = new Set<() => void>();

/** 头插并去重提升；超过上限裁断；通知订阅者（防抖落盘入口）。 */
export function record(id: string): void {
  ids = [id, ...ids.filter((x) => x !== id)].slice(0, LIMIT);
  subscribers.forEach((cb) => cb());
}

/** record 变更订阅（hydrate 不通知——启动恢复不应触发回写）。 */
export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** 返回副本，MRU 序（最近执行在前）。 */
export function list(): string[] {
  return [...ids];
}

/** 整体载入（persistSettings 启动时从 settings.json 恢复）。 */
export function hydrate(next: string[]): void {
  ids = next.slice(0, LIMIT);
}
