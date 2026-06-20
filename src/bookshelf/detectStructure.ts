import { readingFormatOf } from '../editor/reading/openReading';
import type { BookChapter, BookVolume, DirTreeEntry } from '../types/bookshelf';
import type { ReadingFormat } from '../types/reading';

/**
 * 文件夹结构识别（FEAT-SHELF）：把 list_dir_tree 的目录树映射为「卷-章」。纯逻辑、可单测。
 * 规则：根的子目录 = 卷（其下递归文件 = 章）；根下松散文件归入「正文」卷；无子目录则所有文件为单卷。
 * 仅收录 txt/docx/epub/pdf；中英数混排按自然序（第2章 < 第10章）。
 */
const CN_DIGIT: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** 中文数字串 → 数值（十二=12、二十=20、一百零三=103）；非纯数字串返回 null。 */
function cnToNum(s: string): number | null {
  let section = 0;
  let num = 0;
  let seen = false;
  for (const ch of s) {
    if (ch in CN_DIGIT) {
      num = CN_DIGIT[ch];
      seen = true;
    } else if (ch in CN_UNIT) {
      section += (num || 1) * CN_UNIT[ch];
      num = 0;
      seen = true;
    } else {
      return null;
    }
  }
  return seen ? section + num : null;
}

/** 从名称提取序号：优先阿拉伯数字，其次中文数字（第一章 / 第10章 均可），无则 null。 */
function extractNum(name: string): number | null {
  const arabic = name.match(/\d+/);
  if (arabic) return Number(arabic[0]);
  const cn = name.match(/[零一二两三四五六七八九十百千]+/);
  return cn ? cnToNum(cn[0]) : null;
}

/** 自然序：能提取序号则按序号（含中文数字），否则按 locale（numeric）。 */
function naturalCompare(a: string, b: string): number {
  const na = extractNum(a);
  const nb = extractNum(b);
  if (na !== null && nb !== null && na !== nb) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** 递归收集子树下所有文件叶子（卷内深层文件折叠为该卷的章）。 */
function collectFiles(entry: DirTreeEntry): DirTreeEntry[] {
  const out: DirTreeEntry[] = [];
  for (const c of entry.children) {
    if (c.isDir) out.push(...collectFiles(c));
    else out.push(c);
  }
  return out;
}

function toChapters(files: DirTreeEntry[]): BookChapter[] {
  return files
    .map((e) => ({ e, format: readingFormatOf(e.path) }))
    .filter((x): x is { e: DirTreeEntry; format: ReadingFormat } => x.format !== null)
    .sort((a, b) => naturalCompare(a.e.name, b.e.name))
    .map(({ e, format }) => ({ title: stripExt(e.name), path: e.path, format }));
}

export function detectStructure(tree: DirTreeEntry, bookTitle: string): BookVolume[] {
  const dirs = tree.children.filter((c) => c.isDir).sort((a, b) => naturalCompare(a.name, b.name));
  const loose = toChapters(tree.children.filter((c) => !c.isDir));
  if (dirs.length === 0) {
    return loose.length ? [{ title: bookTitle, chapters: loose }] : [];
  }
  const volumes: BookVolume[] = [];
  if (loose.length) volumes.push({ title: '正文', chapters: loose });
  for (const dir of dirs) {
    const chapters = toChapters(collectFiles(dir));
    if (chapters.length) volumes.push({ title: dir.name, chapters });
  }
  return volumes;
}
