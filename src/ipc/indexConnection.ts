import Database from '@tauri-apps/plugin-sql';
import type { IndexScope } from '../types/index';
import { indexDbUrl, isCurrentIndexScope } from './indexScope';

interface Connection {
  scope: IndexScope;
  url: string;
  promise: Promise<Database>;
}

let connection: Connection | null = null;
const closing = new Set<Connection>();
let closingTask: Promise<void> = Promise.resolve();

export function retireIndexRead(scope: IndexScope): void {
  if (connection?.scope.sessionId === scope.sessionId) {
    closing.add(connection);
    connection = null;
  }
}

/** plugin-sql close()不带库名会关闭所有池，因此始终传原scope的准确连接名。 */
export function closeIndexReads(): Promise<void> {
  closingTask = closingTask.catch(() => {}).then(async () => {
    for (const old of [...closing]) {
      let db: Database;
      try {
        db = await old.promise;
      } catch {
        closing.delete(old); // 加载未成功，不存在需要关闭的池。
        continue;
      }
      await db.close(old.url);
      closing.delete(old); // 失败时保留句柄，下一次显式重试仍能回收。
    }
  });
  return closingTask;
}

export async function indexConnection(scope: IndexScope): Promise<Database> {
  if (connection && connection.scope.sessionId !== scope.sessionId) retireIndexRead(connection.scope);
  await closeIndexReads();
  if (!isCurrentIndexScope(scope)) throw new Error('索引工作区会话已过期');
  if (!connection) {
    const url = indexDbUrl(scope);
    connection = { scope, url, promise: Database.load(url) };
  }
  const own = connection;
  try {
    const db = await own.promise;
    if (!isCurrentIndexScope(scope)) {
      retireIndexRead(scope);
      await closeIndexReads();
      throw new Error('索引工作区会话已过期');
    }
    return db;
  } catch (error) {
    if (connection === own) connection = null;
    throw error;
  }
}
