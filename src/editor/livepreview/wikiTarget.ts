import type { FileEntry } from '../../types/vault';
import { isMarkdownPath, withoutMarkdownExtension } from '../pathUtil';

/**
 * wiki-link target 解析纯逻辑（Phase 4 W3 跳转 / 后续 W2' 抽链共用）。
 *
 * target 内核形如 `path#heading^block`（`#heading` / `^block` 可选）。本模块保留目标片段并解析文件身份，
 * 不碰 EditorView / store。精确路径优先；裸名多匹配不猜首个，显式路径不降级到别处的同名文件。
 */

/** 分隔归一为 '/'（避免正则字面量）。 */
function toSlash(s: string): string {
  return s.split('\\').join('/');
}

export interface WikiTarget {
  path: string;
  heading: string | null;
  block: string | null;
}

/** `#^id` 与 `^id` 都是块目标；空路径可由导航层解释为当前文档。 */
export function parseWikiTarget(raw: string): WikiTarget {
  const hash = raw.indexOf('#');
  const caret = raw.indexOf('^');
  const end = Math.min(hash < 0 ? raw.length : hash, caret < 0 ? raw.length : caret);
  const heading = hash >= 0 && (caret < 0 || hash < caret)
    ? raw.slice(hash + 1, caret < 0 ? undefined : caret).trim()
    : '';
  return {
    path: raw.slice(0, end).trim(),
    heading: heading || null,
    block: caret >= 0 ? raw.slice(caret + 1).trim() || null : null,
  };
}

/** 剥离片段，只取路径；需要定位的调用方须保留 parseWikiTarget 的全部结果。 */
export function wikiTargetPath(raw: string): string {
  return parseWikiTarget(raw).path;
}

/** 只生成 vault 内相对路径；NFC 仅用于匹配，不改返回的真实文件路径或正文。 */
function normalizedPath(raw: string): string | null {
  const path = toSlash(raw).trim().normalize('NFC');
  if (!path || path.startsWith('/') || path.endsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path) || /[\0\r\n|]/.test(path) || path.includes('[') || path.includes(']')) return null;
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

function withoutMd(path: string): string {
  return withoutMarkdownExtension(path);
}

function addCandidate(table: Map<string, string[]>, key: string, path: string): void {
  const candidates = table.get(key);
  if (candidates) candidates.push(path);
  else table.set(key, [path]);
}

/** 一份文件快照只建表一次；表键可归一化，候选值始终保留真实文件身份。 */
function candidateLookup(files: readonly FileEntry[]): (targetPath: string) => readonly string[] {
  const exact = new Map<string, string[]>();
  const extended = new Map<string, string[]>();
  const basenames = new Map<string, string[]>();
  for (const path of new Set(files.map((file) => file.path))) {
    const normalized = normalizedPath(path);
    if (!normalized) continue;
    addCandidate(exact, normalized, path);
    if (isMarkdownPath(path)) addCandidate(extended, withoutMd(normalized), path);
    addCandidate(basenames, withoutMd(normalized.split('/').pop() ?? normalized), path);
  }
  return (targetPath) => {
    const target = normalizedPath(targetPath);
    if (!target) return [];
    const matching = exact.get(target) ?? extended.get(withoutMd(target));
    if (matching) return matching;
    return toSlash(targetPath).includes('/') ? [] : basenames.get(withoutMd(target)) ?? [];
  };
}

/** 返回候选身份，让导航区分「不存在」和「有歧义」，避免把歧义链接当成新文件。 */
export function wikiTargetCandidates(targetPath: string, files: readonly FileEntry[]): string[] {
  return [...candidateLookup(files)(targetPath)];
}

/** 图谱/反链批量解析复用同一份查找表，避免每条边重新扫描整个工作区。 */
export function createWikiResolver(files: readonly FileEntry[]): (targetPath: string) => string | null {
  const candidatesFor = candidateLookup(files);
  return (targetPath) => {
    const candidates = candidatesFor(targetPath);
    return candidates.length === 1 ? candidates[0] : null;
  };
}

/** 只有唯一候选才返回真实路径，缺失或歧义返回 null。 */
export function resolveWikiTarget(targetPath: string, files: readonly FileEntry[]): string | null {
  return createWikiResolver(files)(targetPath);
}

/** target 路径 → 建链相对路径（补 `.md`）。目标不存在时据此 createFile。 */
export function wikiTargetToCreatePath(targetPath: string): string | null {
  const path = normalizedPath(targetPath);
  return path === null ? null : isMarkdownPath(path) ? path : `${path}.md`;
}
