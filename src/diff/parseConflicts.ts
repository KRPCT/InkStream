/** Strict Git marker parsing. Every retained span includes its original line ending. */
export type ConflictChoice = 'ours' | 'theirs' | 'both';
export interface CleanPart { kind: 'clean'; text: string }
export interface ConflictPart { kind: 'conflict'; ours: string; theirs: string; base: string | null }
export type MergePart = CleanPart | ConflictPart;
export type ParsedConflicts = { kind: 'valid'; parts: MergePart[] } | { kind: 'invalid'; error: string; line: number };

interface Marker { kind: '<' | '|' | '=' | '>'; width: number }
function marker(line: string): Marker | null {
  const match = /^(<{7,}|\|{7,}|={7,}|>{7,})(.*)$/.exec(line);
  if (!match || (match[2] && !/^[ \t]/.test(match[2]))) return null;
  const kind = match[1][0] as Marker['kind'];
  if (kind === '=' && match[2]) return null;
  return { kind, width: match[1].length };
}

export function parseConflicts(content: string): ParsedConflicts {
  const parts: MergePart[] = [];
  let cleanFrom = 0;
  let active: { width: number; stage: 'ours' | 'base' | 'theirs'; oursFrom: number; ours: string; baseFrom: number; base: string | null; theirsFrom: number } | null = null;
  let lineNumber = 0;
  // A standalone Markdown setext underline is ordinary text. Once a start/end/base
  // marker occurs, orphan separators are ambiguous damaged input and must be rejected.
  const hasBoundary = /^(?:<{7,}|>{7,}|\|{7,})(?:[ \t]|\r?$)/m.test(content);
  for (const match of content.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    const raw = match[0];
    if (!raw) continue;
    lineNumber++;
    const line = raw.replace(/(?:\r\n|\n|\r)$/, '');
    const token = marker(line);
    if (!token) continue;
    const start = match.index;
    const after = start + raw.length;
    const invalid = (reason: string): ParsedConflicts => ({ kind: 'invalid', line: lineNumber, error: `第 ${lineNumber} 行冲突标记无效：${reason}。原文已保留，未允许标记解决。` });
    if (!active) {
      if (token.kind !== '<') {
        if (token.kind === '=' && !hasBoundary) continue;
        return invalid('缺少对应的开始标记');
      }
      if (start > cleanFrom) parts.push({ kind: 'clean', text: content.slice(cleanFrom, start) });
      active = { width: token.width, stage: 'ours', oursFrom: after, ours: '', baseFrom: 0, base: null, theirsFrom: 0 };
      continue;
    }
    if (token.width !== active.width) return invalid('标记长度不一致');
    if (token.kind === '<') return invalid('存在嵌套或重复开始标记');
    if (token.kind === '|') {
      if (active.stage !== 'ours') return invalid('基线标记顺序错误');
      active.ours = content.slice(active.oursFrom, start);
      active.baseFrom = after;
      active.stage = 'base';
    } else if (token.kind === '=') {
      if (active.stage === 'theirs') return invalid('存在重复分隔标记');
      if (active.stage === 'ours') active.ours = content.slice(active.oursFrom, start);
      else active.base = content.slice(active.baseFrom, start);
      active.theirsFrom = after;
      active.stage = 'theirs';
    } else {
      if (active.stage !== 'theirs') return invalid('缺少分隔标记');
      parts.push({ kind: 'conflict', ours: active.ours, base: active.base, theirs: content.slice(active.theirsFrom, start) });
      active = null;
      cleanFrom = after;
    }
  }
  if (active) return { kind: 'invalid', line: lineNumber, error: '冲突标记未完整结束。原文已保留，未允许标记解决。' };
  if (cleanFrom < content.length || !parts.length) parts.push({ kind: 'clean', text: content.slice(cleanFrom) });
  return { kind: 'valid', parts };
}

export function conflictCount(parsed: ParsedConflicts): number {
  return parsed.kind === 'valid' ? parsed.parts.filter((part) => part.kind === 'conflict').length : 0;
}

export function assembleResolution(parsed: ParsedConflicts, choices: readonly (ConflictChoice | null)[]): string {
  if (parsed.kind === 'invalid') throw new Error(parsed.error);
  let index = 0;
  const text = parsed.parts.map((part) => {
    if (part.kind === 'clean') return part.text;
    const choice = choices[index++];
    if (!choice) throw new Error('请先为每处冲突选择解决方式。');
    return choice === 'ours' ? part.ours : choice === 'theirs' ? part.theirs : part.ours + part.theirs;
  }).join('');
  if (index !== choices.length) throw new Error('冲突选择与当前文档不一致，请重新读取。');
  return text;
}
