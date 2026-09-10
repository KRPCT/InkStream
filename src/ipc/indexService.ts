import type Database from '@tauri-apps/plugin-sql';
import { createWikiResolver, wikiTargetPath } from '../editor/livepreview/wikiTarget';
import { collectWikiReferences, type BacklinkReference } from '../editor/wikiReferences';
import { useIndexStore } from '../stores/useIndexStore';
import type { FileEntry } from '../types/vault';
import { indexConnection, retireIndexRead } from './indexConnection';
import { captureIndexScope, isCurrentIndexScope } from './indexScope';
import { ensureIndexReady, recordIndexError } from './indexSession';

export { captureIndexScope, indexDbUrl } from './indexScope';
export { pauseIndexSession } from './indexPause';
export { indexUpsertDoc, indexRefreshFile, indexRemoveDoc, indexRebuild, indexSwitchVault, initIndexLifecycle } from './indexSession';
export type { IndexScope } from '../types/index';
export type { BacklinkReference } from '../editor/wikiReferences';

export function isIndexable(path: string): boolean {
  return path.endsWith('.md');
}

/** disabled/无库可为空；prepare与SQL失败必须明确，不能伪装为合法零命中。 */
async function readIndex<T>(empty: T, read: (db: Database) => Promise<T>): Promise<T> {
  const scope = captureIndexScope();
  if (!scope) return empty;
  let readRevision: number | null = null;
  try {
    await ensureIndexReady(scope);
    readRevision = useIndexStore.getState().revision;
    const db = await indexConnection(scope);
    const result = await read(db);
    const current = useIndexStore.getState();
    if (!isCurrentIndexScope(scope) || current.revision !== readRevision || current.status === 'preparing') {
      throw new Error('索引查询快照已过期，请重新查询');
    }
    return result;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    const failure = new Error(`索引查询失败：${cause}`);
    const current = useIndexStore.getState();
    // prepare 自己报告当前代失败；旧 prepare/read 的迟到错误不能撤销后来打开的连接。
    if (readRevision !== null && isCurrentIndexScope(scope) &&
      current.revision === readRevision && current.status !== 'preparing') {
      retireIndexRead(scope);
      recordIndexError(scope, failure);
    }
    throw failure;
  }
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

/** 单条 SELECT 同时读取完整身份集合与潜在来源正文，避免读取期间混用两个提交快照。 */
export function queryBacklinkReferences(filePath: string): Promise<BacklinkReference[]> {
  const target = filePath.split('\\').join('/');
  const name = (target.split('/').pop() ?? target).replace(/\.md$/i, '').normalize('NFC');
  return readIndex([], async (db) => {
    // 原生 links 已排除 Markdown 示例；子串只粗筛来源，真正目标仍由统一 resolver 消歧。
    const rows = await db.select<Array<{ path: string; content: string | null }>>(
      'SELECT f.path, CASE WHEN EXISTS (SELECT 1 FROM links l WHERE l.source_path=f.path ' +
      'AND instr(l.target_raw, ?) > 0) THEN f.content ELSE NULL END AS content FROM files f ORDER BY f.path', [name],
    );
    const resolve = createWikiResolver(rows.map(({ path }) => ({ path, name: path.split('/').pop() ?? path })));
    return rows.flatMap(({ path, content }) => {
      if (path === target || content === null) return [];
      return collectWikiReferences(content).filter((reference) => resolve(reference.targetPath) === target)
        .map((reference) => ({ ...reference, sourcePath: path }));
    });
  });
}

export interface ContentHit {
  path: string;
  snippet: string;
}

export async function queryContent(text: string): Promise<ContentHit[]> {
  const term = text.trim();
  if (term.length < 3) return [];
  return readIndex([], async (db) => {
    const rows = await db.select<Array<{ path: string; snippet: string }>>(
      "SELECT path, snippet(files_fts, 0, '', '', '…', 32) AS snippet " +
      'FROM files_fts WHERE files_fts MATCH ? ORDER BY rank LIMIT 50', [phrase(term)],
    );
    return rows.map((r) => ({ path: r.path, snippet: (r.snippet ?? '').replace(/\s+/g, ' ').trim() }));
  });
}

export async function queryContentPaths(text: string, limit = 500): Promise<string[]> {
  const term = text.trim();
  if (term.length < 3) return [];
  return readIndex([], async (db) => {
    const cap = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 500;
    const rows = await db.select<Array<{ path: string }>>(
      `SELECT path FROM files_fts WHERE files_fts MATCH ? ORDER BY path LIMIT ${cap}`, [phrase(term)],
    );
    return rows.map((row) => row.path);
  });
}

export function queryUnlinkedMentions(filePath: string): Promise<string[]> {
  const path = pathIdentity(filePath);
  const name = (path.split('/').pop() ?? path).replace(/\.md$/, '').normalize('NFC');
  if (name.length < 3) return Promise.resolve([]);
  return readIndex([], async (db) => {
    const rows = await db.select<Array<{ path: string }>>(
      'SELECT path FROM files_fts WHERE files_fts MATCH ? ORDER BY path LIMIT 100', [phrase(name)],
    );
    const linked = new Set(await backlinks(db, filePath));
    return rows.map((row) => row.path).filter((candidate) => pathIdentity(candidate) !== path && !linked.has(candidate));
  });
}

export function queryGraphData(): Promise<{ files: string[]; links: RawLink[] }> {
  return readIndex({ files: [], links: [] }, async (db) => {
    const files = await db.select<Array<{ path: string }>>('SELECT path FROM files ORDER BY path');
    const links = await db.select<RawLink[]>('SELECT source_path, target_raw FROM links');
    return { files: files.map((row) => row.path), links };
  });
}
