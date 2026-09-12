import { bodyStart, writeField } from './frontmatter';
import type { CodexEntry, CodexType } from '../types/creative';

export const CODEX_TYPE_LABEL: Record<CodexType, string> = { character: '角色', location: '地点', lore: '设定' };
export interface CodexFields { type: CodexType; name: string; aliases: string[]; summary: string }
const keys = ['type', 'name', 'aliases', 'summary'] as const;

function scalar(value: string): string {
  const raw = value.trim();
  if (raw.startsWith('"')) {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'string') throw new Error('字段应为文本');
    return parsed;
  }
  if (raw.startsWith("'")) {
    if (!raw.endsWith("'")) throw new Error('文本引号未闭合');
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[|>{[&*!]/.test(raw)) throw new Error('请使用单行文本或带引号的文本字段');
  return raw.replace(/\s+#.*$/, '').trim();
}

/** Read four supported fields; unknown metadata and Markdown remain untouched. */
export function parseCodexEntry(path: string, doc: string): CodexEntry {
  const normalized = doc.replace(/\r\n/g, '\n');
  const end = bodyStart(normalized);
  if (!end) throw new Error('缺少闭合的 frontmatter');
  const header = normalized.slice(4, end).replace(/\n---\s*$/, '');
  const fields: Record<string, string> = {};
  for (const key of keys) {
    const matches = [...header.matchAll(new RegExp(`^${key}:[ \\t]*(.*)$`, 'gm'))];
    if (matches.length > 1) throw new Error(`字段 ${key} 重复`);
    if (matches[0]) fields[key] = matches[0][1];
  }
  const type = scalar(fields.type ?? '') as CodexType;
  const name = scalar(fields.name ?? '');
  if (!Object.hasOwn(CODEX_TYPE_LABEL, type) || !name.trim()) throw new Error('需要有效的 type 和 name');
  const rawAliases = fields.aliases?.trim() ?? '';
  let aliases: string[] = [];
  if (rawAliases.startsWith('[')) {
    const parsed: unknown = JSON.parse(rawAliases);
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) throw new Error('aliases 应为文本列表');
    aliases = parsed;
  } else if (rawAliases) aliases = scalar(rawAliases).split(/[,，]/);
  const summary = fields.summary === undefined
    ? normalized.slice(end).trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' ')
    : scalar(fields.summary);
  return { path, type, name: name.trim(), aliases: [...new Set(aliases.map((a) => a.trim()).filter(Boolean))], summary };
}

export function validateCodexFields(fields: CodexFields): CodexFields {
  const name = fields.name.trim();
  const aliases = [...new Set(fields.aliases.map((alias) => alias.trim()).filter(Boolean))];
  if (!Object.hasOwn(CODEX_TYPE_LABEL, fields.type) || !name) throw new Error('请选择类型并填写名称。');
  if (name.length > 120 || aliases.length > 20 || aliases.some((a) => a.length > 120) || fields.summary.length > 4000)
    throw new Error('名称和别名限 120 字，别名最多 20 个，概要限 4000 字。');
  if ([name, ...aliases].some((text) => [...text].some((character) => character.codePointAt(0)! < 32))) throw new Error('名称和别名不能包含换行或控制字符。');
  return { ...fields, name, aliases };
}

export function updateCodexMetadata(doc: string, fields: CodexFields): string {
  const ending = doc.includes('\r\n') ? '\r\n' : '\n';
  let next = doc.replace(/\r\n/g, '\n');
  const values = { type: fields.type, name: JSON.stringify(fields.name), aliases: JSON.stringify(fields.aliases), summary: JSON.stringify(fields.summary) };
  for (const key of keys) next = writeField(next, key, values[key]);
  return ending === '\r\n' ? next.replace(/\n/g, '\r\n') : next;
}
