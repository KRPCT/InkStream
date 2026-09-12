import type { IndexLocation, IndexScope } from '../types/index';

const locations = new WeakMap<IndexScope, Readonly<IndexLocation>>();

/** Location is an acknowledgement from native ProjectRepository resolution, never a root-derived guess. */
export function bindIndexLocation(scope: IndexScope, location: IndexLocation | null): void {
  if (!location || typeof location.projectId !== 'string' || !location.projectId
    || typeof location.databaseUrl !== 'string' || !/^sqlite:(?:[a-z]:\/|\/)/i.test(location.databaseUrl)
    || !location.databaseUrl.endsWith('/index.db')) throw new Error('原生索引没有返回有效的本机数据库位置。');
  if (scope.projectId && location.projectId !== scope.projectId) throw new Error('索引位置不属于当前项目。');
  const previous = locations.get(scope);
  if (previous && (previous.projectId !== location.projectId || previous.databaseUrl !== location.databaseUrl)) {
    throw new Error('同一索引会话的项目位置发生变化，请重新打开项目。');
  }
  locations.set(scope, Object.freeze({ ...location }));
}

export function indexDbUrl(scope: IndexScope): string {
  const location = locations.get(scope);
  if (!location) throw new Error('原生索引位置尚未确认，未打开任何数据库。');
  return location.databaseUrl;
}
