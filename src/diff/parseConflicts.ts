/**
 * 解析 git 合并冲突标记（Phase 12 DIFF-03）。git merge 冲突时已把可自动合并的部分并入工作文件，
 * 仅真冲突处留 `<<<<<<< ours` / `=======`（/ diff3 的 `||||||| base`）/ `>>>>>>> theirs` 标记。
 * 本模块把内容切成「干净段（git 已合好，原样保留）」与「冲突块（ours/theirs 两版本）」。纯函数可单测。
 */

export type ConflictChoice = 'ours' | 'theirs' | 'both';

export interface CleanPart {
  kind: 'clean';
  text: string;
}
export interface ConflictPart {
  kind: 'conflict';
  ours: string;
  theirs: string;
}
export type MergePart = CleanPart | ConflictPart;

/** 解析含合并标记的文本为有序片段序列；无标记 → 单个 clean 段。 */
export function parseConflicts(content: string): MergePart[] {
  const lines = content.split('\n');
  const parts: MergePart[] = [];
  let clean: string[] = [];
  const flush = (): void => {
    if (clean.length > 0) {
      parts.push({ kind: 'clean', text: clean.join('\n') });
      clean = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      flush();
      i++;
      const ours: string[] = [];
      while (
        i < lines.length &&
        !lines[i].startsWith('=======') &&
        !lines[i].startsWith('|||||||')
      ) {
        ours.push(lines[i]);
        i++;
      }
      // diff3 风格的 base 块（||||||| … =======）丢弃：解决以 ours/theirs 为准。
      if (i < lines.length && lines[i].startsWith('|||||||')) {
        i++;
        while (i < lines.length && !lines[i].startsWith('=======')) i++;
      }
      if (i < lines.length && lines[i].startsWith('=======')) i++;
      const theirs: string[] = [];
      while (i < lines.length && !lines[i].startsWith('>>>>>>>')) {
        theirs.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].startsWith('>>>>>>>')) i++;
      parts.push({ kind: 'conflict', ours: ours.join('\n'), theirs: theirs.join('\n') });
    } else {
      clean.push(lines[i]);
      i++;
    }
  }
  flush();
  return parts;
}

/** 冲突块数量。 */
export function conflictCount(parts: MergePart[]): number {
  return parts.filter((p) => p.kind === 'conflict').length;
}

/** 按每个冲突块的选择组装最终文本（choices 顺序对应冲突块顺序；缺省按 ours）。 */
export function assembleResolution(parts: MergePart[], choices: ConflictChoice[]): string {
  let ci = 0;
  const out: string[] = [];
  for (const p of parts) {
    if (p.kind === 'clean') {
      out.push(p.text);
      continue;
    }
    const c = choices[ci++] ?? 'ours';
    const text =
      c === 'theirs'
        ? p.theirs
        : c === 'both'
          ? [p.ours, p.theirs].filter((s) => s.length > 0).join('\n')
          : p.ours;
    // 采纳一侧为空（纯删除冲突）→ 该块不贡献任何行，避免组装出原文不存在的空行。
    if (text.length > 0) out.push(text);
  }
  return out.join('\n');
}
