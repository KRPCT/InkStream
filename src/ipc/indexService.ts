import type Database from '@tauri-apps/plugin-sql';
import { createWikiResolver, wikiTargetPath } from '../editor/livepreview/wikiTarget';
import { MAX_REFERENCE_UNITS, type BacklinkReference } from '../editor/wikiReferences';
import { readUnlinkedMention, readWikiReferences } from '../editor/wikiReferenceClient';
import { isMarkdownPath, withoutMarkdownExtension } from '../editor/pathUtil';
import { useIndexStore } from '../stores/useIndexStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { IndexScope } from '../types/index';
import type { FileEntry } from '../types/vault';
import { indexConnection, retireIndexRead } from './indexConnection';
import { captureIndexScope, isCurrentIndexScope } from './indexScope';
import { ensureIndexReady, recordIndexError } from './indexSession';
import { readFile } from './files';

export { captureIndexScope, indexDbUrl } from './indexScope';
export { pauseIndexSession } from './indexPause';
export { indexUpsertDoc, indexRefreshFile, indexRemoveDoc, indexRebuild, indexSwitchVault, initIndexLifecycle } from './indexSession';
export type { IndexScope } from '../types/index';
export type { BacklinkReference } from '../editor/wikiReferences';

export function isIndexable(path: string): boolean {
  return isMarkdownPath(path);
}

class SourceReadError extends Error {}
interface QueryOptions { signal?: AbortSignal }
function abortQuery(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('索引查询已取消', 'AbortError');
}

/** disabled/无库可为空；prepare与SQL失败必须明确，不能伪装为合法零命中。 */
async function readIndex<T>(empty: T, read: (db: Database, scope: IndexScope, signal: AbortSignal) => Promise<T>, options?: QueryOptions): Promise<T> {
  if (options?.signal?.aborted) throw new DOMException('索引查询已取消', 'AbortError');
  const scope = captureIndexScope();
  if (!scope) return empty;
  let readRevision: number | null = null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  options?.signal?.addEventListener('abort', abort, { once: true });
  const subscriptions: Array<() => void> = [];
  try {
    await ensureIndexReady(scope);
    abortQuery(controller.signal);
    readRevision = useIndexStore.getState().revision;
    const cancelIfStale = () => {
      if (!isCurrentIndexScope(scope) || useIndexStore.getState().revision !== readRevision || useIndexStore.getState().status !== 'ready') controller.abort();
    };
    subscriptions.push(useVaultStore.subscribe(cancelIfStale), useSettingsStore.subscribe(cancelIfStale), useIndexStore.subscribe(cancelIfStale));
    cancelIfStale();
    const db = await indexConnection(scope);
    abortQuery(controller.signal);
    const result = await read(db, scope, controller.signal);
    abortQuery(controller.signal);
    const current = useIndexStore.getState();
    if (!isCurrentIndexScope(scope) || current.revision !== readRevision || current.status === 'preparing') {
      throw new Error('索引查询快照已过期，请重新查询');
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new DOMException('索引查询已取消', 'AbortError');
    const cause = error instanceof Error ? error.message : String(error);
    const failure = new Error(`索引查询失败：${cause}`);
    const current = useIndexStore.getState();
    // prepare 自己报告当前代失败；旧 prepare/read 的迟到错误不能撤销后来打开的连接。
    if (!(error instanceof SourceReadError) && readRevision !== null && isCurrentIndexScope(scope) &&
      current.revision === readRevision && current.status !== 'preparing') {
      retireIndexRead(scope);
      recordIndexError(scope, failure);
    }
    throw failure;
  } finally {
    subscriptions.forEach((unsubscribe) => unsubscribe());
    options?.signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

async function sourceText(scope: IndexScope, path: string, signal: AbortSignal): Promise<string> {
  try { return await readFile(scope.root, path, { signal }); }
  catch (error) { throw new SourceReadError(`无法读取关联来源 ${path}：${String(error)}`); }
}

function pathIdentity(path: string): string {
  return path.split('\\').join('/');
}

function phrase(text: string): string {
  return `"${text.split('"').join('""')}"`;
}

interface RawLink { source_path: string; target_raw: string }

async function backlinks(db: Database, filePath: string): Promise<string[]> {
  const files = await db.select<Array<{ path: string }>>('SELECT path FROM files ORDER BY path');
  const links = await db.select<RawLink[]>('SELECT source_path, target_raw FROM links');
  const entries: FileEntry[] = files.map(({ path }) => ({ path, name: path.split('/').pop() ?? path }));
  const resolve = createWikiResolver(entries);
  const target = pathIdentity(filePath);
  return [...new Set(links.filter((link) => {
    const resolved = resolve(wikiTargetPath(link.target_raw));
    return resolved !== null && pathIdentity(resolved) === target && pathIdentity(link.source_path) !== target;
  }).map((link) => link.source_path))].sort();
}

/** 与点击导航/图谱共用唯一目标规则，显式路径缺失和裸名歧义都不猜目标。 */
export function queryBacklinks(filePath: string): Promise<string[]> {
  return readIndex([], (db) => backlinks(db, filePath));
}

/** SQL only returns identities; source text uses Raw/ACK and large parsing runs off the UI thread. */
export function queryBacklinkReferences(filePath: string, options?: QueryOptions): Promise<BacklinkReference[]> {
  const target = filePath.split('\\').join('/');
  const name = withoutMarkdownExtension(target.split('/').pop() ?? target).normalize('NFC');
  return readIndex([], async (db, scope, signal) => {
    // 原生 links 已排除 Markdown 示例；子串只粗筛来源，真正目标仍由统一 resolver 消歧。
    const rows = await db.select<Array<{ path: string; candidate: number }>>(
      'SELECT f.path, EXISTS (SELECT 1 FROM links l WHERE l.source_path=f.path ' +
      'AND instr(l.target_raw, ?) > 0) AS candidate FROM files f ORDER BY f.path', [name],
    );
    const resolve = createWikiResolver(rows.map(({ path }) => ({ path, name: path.split('/').pop() ?? path })));
    const references: BacklinkReference[] = [];
    let replyUnits = 0;
    for (const { path, candidate } of rows) {
      abortQuery(signal);
      if (path === target || !candidate) continue;
      const content = await sourceText(scope, path, signal);
      try {
        for (const reference of await readWikiReferences(content, signal)) {
          if (resolve(reference.targetPath) === target) {
            replyUnits += reference.context.length + reference.linkText.length + reference.targetPath.length + path.length + 100;
            if (replyUnits > MAX_REFERENCE_UNITS) throw new Error('反向链接超过当前显示预算，未返回部分结果。请使用全文搜索定位。');
            references.push({ ...reference, sourcePath: path });
          }
        }
      } catch (error) { throw new SourceReadError(`${path}：${String(error)}`); }
    }
    return references;
  }, options);
}

export interface ContentHit {
  path: string;
  snippet: string;
}

export async function queryContent(text: string): Promise<ContentHit[]> {
  const term = text.trim();
  if (!term) return [];
  return readIndex([], async (db) => {
    const rows = await db.select<Array<{ path: string; snippet: string }>>(
      term.length < 3
        ? 'SELECT path, substr(content, max(1, instr(lower(content), lower(?))-24), 80) AS snippet FROM files WHERE instr(lower(content), lower(?)) > 0 ORDER BY path LIMIT 50'
        : "SELECT path, snippet(files_fts, 0, '', '', '…', 32) AS snippet FROM files_fts WHERE files_fts MATCH ? ORDER BY rank LIMIT 50",
      term.length < 3 ? [term, term] : [phrase(term)],
    );
    return rows.map((r) => ({ path: r.path, snippet: (r.snippet ?? '').replace(/\s+/g, ' ').trim() }));
  });
}

export async function queryContentPaths(text: string, limit = 500, options?: QueryOptions): Promise<string[]> {
  const term = text.trim();
  if (!term) return [];
  return readIndex([], async (db) => {
    const cap = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 500;
    const rows = await db.select<Array<{ path: string }>>(
      term.length < 3
        ? `SELECT path FROM files WHERE instr(lower(content), lower(?)) > 0 ORDER BY path LIMIT ${cap}`
        : `SELECT path FROM files_fts WHERE files_fts MATCH ? ORDER BY path LIMIT ${cap}`,
      [term.length < 3 ? term : phrase(term)],
    );
    return rows.map((row) => row.path);
  }, options);
}

export function queryUnlinkedMentions(filePath: string, options?: QueryOptions): Promise<string[]> {
  const path = pathIdentity(filePath);
  const name = withoutMarkdownExtension(path.split('/').pop() ?? path).normalize('NFC');
  if (!name) return Promise.resolve([]);
  return readIndex([], async (db, scope, signal) => {
    const rows = await db.select<Array<{ path: string; candidate: number }>>(
      'SELECT path, (instr(lower(content), lower(?)) > 0 OR instr(lower(content), lower(?)) > 0) AS candidate FROM files ORDER BY path', [name, name.normalize('NFD')],
    );
    const resolve = createWikiResolver(rows.map(({ path }) => ({ path, name: path.split('/').pop() ?? path })));
    if (resolve(name) !== path) throw new SourceReadError('存在同名文档，未链接提及无法唯一归属；显式链接仍正常显示。');
    const linked = new Set(await backlinks(db, filePath));
    const found: string[] = [];
    for (const row of rows) {
      abortQuery(signal);
      if (!row.candidate || pathIdentity(row.path) === path || linked.has(row.path)) continue;
      const content = await sourceText(scope, row.path, signal);
      try { if (await readUnlinkedMention(content, name, signal)) found.push(row.path); }
      catch (error) { throw new SourceReadError(`${row.path}：${String(error)}`); }
    }
    return found;
  }, options);
}

export function queryGraphData(): Promise<{ files: string[]; links: RawLink[] }> {
  return readIndex({ files: [], links: [] }, async (db) => {
    const files = await db.select<Array<{ path: string }>>('SELECT path FROM files ORDER BY path');
    const links = await db.select<RawLink[]>('SELECT source_path, target_raw FROM links');
    return { files: files.map((row) => row.path), links };
  });
}
