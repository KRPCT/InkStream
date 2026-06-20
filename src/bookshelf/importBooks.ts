import { readingFormatOf } from '../editor/reading/openReading';
import { pickBookFiles, pickFolder } from '../ipc/dialog';
import { listDirTree } from '../ipc/files';
import { isPathShelved, useBookshelfStore } from '../stores/useBookshelfStore';
import { showToast } from '../stores/useToastStore';
import type { Book } from '../types/bookshelf';
import type { ReadingFormat } from '../types/reading';
import { detectStructure } from './detectStructure';
import { extractEpubCover } from './epubCover';
import { placeholderCover } from './placeholderCover';

/**
 * 书籍导入编排（FEAT-SHELF）：单文件多选 + 文件夹（书→卷→章）。索引 only，绝不改源文件。
 * 单文件 → 1 卷 1 章；文件夹 → detectStructure 识别卷-章。封面：epub 提取，其余生成占位卡。
 */

/** 稳定 id：rootPath 简单哈希（重复导入幂等去重，亦作「是否已在架」判定）。 */
export function bookIdFor(rootPath: string): string {
  let h = 0;
  for (let i = 0; i < rootPath.length; i += 1) h = (h * 31 + rootPath.charCodeAt(i)) | 0;
  return `book_${(h >>> 0).toString(36)}`;
}

function baseName(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;
}
function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

async function coverFor(format: ReadingFormat, path: string, title: string): Promise<string> {
  if (format === 'epub') {
    const c = await extractEpubCover(path);
    if (c) return c;
  }
  return placeholderCover(title, format);
}

/** 把单个文件作为「单文件书」加入书架（exitReading 的「加入书架」与单文件导入共用）。成功返回 true。 */
export async function addFileToShelf(path: string): Promise<boolean> {
  // 已在架（含被某文件夹书作为章覆盖）则不重复加，避免单文件书与文件夹章重复。
  if (isPathShelved(path)) return false;
  const format = readingFormatOf(path);
  if (!format) return false;
  const title = stripExt(baseName(path));
  const book: Book = {
    id: bookIdFor(path),
    title,
    cover: await coverFor(format, path, title),
    kind: 'file',
    rootPath: path,
    format,
    volumes: [{ title, chapters: [{ title, path, format }] }],
    addedAt: Date.now(),
  };
  useBookshelfStore.getState().addBook(book);
  return true;
}

/** 导入单个/多个书籍文件（多选）。 */
export async function importBookFiles(): Promise<void> {
  const paths = await pickBookFiles();
  if (!paths || paths.length === 0) return;
  let added = 0;
  for (const path of paths) {
    if (await addFileToShelf(path)) added += 1;
  }
  showToast('warning', added ? `已导入 ${added} 本书。` : '所选文件不是支持的书籍格式。');
}

/** 导入一个书籍文件夹（自动识别 书→卷→章）。 */
export async function importBookFolder(): Promise<void> {
  const dir = await pickFolder();
  if (!dir) return;
  let tree;
  try {
    tree = await listDirTree(dir);
  } catch (e) {
    showToast('error', typeof e === 'string' ? e : '无法读取该文件夹。');
    return;
  }
  const title = baseName(dir);
  const volumes = detectStructure(tree, title);
  const first = volumes[0]?.chapters[0];
  if (!first) {
    showToast('warning', '该文件夹内没有可阅读的书籍文件（txt / docx / epub / pdf）。');
    return;
  }
  const chapterCount = volumes.reduce((n, v) => n + v.chapters.length, 0);
  const book: Book = {
    id: bookIdFor(dir),
    title,
    cover: await coverFor(first.format, first.path, title),
    kind: 'folder',
    rootPath: dir,
    format: first.format,
    volumes,
    addedAt: Date.now(),
  };
  useBookshelfStore.getState().addBook(book);
  showToast('warning', `已导入《${title}》（${volumes.length} 卷 ${chapterCount} 章）。`);
}
