/** 书架（FEAT-SHELF）类型契约：阅读模式的书籍索引 + 阅读进度。索引 only，存 app-data，绝不改源文件。 */

import type { ReadingFormat } from './reading';

/** 书籍来源：单文件（一本一文件）或文件夹（书→卷→章）。 */
export type BookKind = 'file' | 'folder';

/** 章节：可独立进阅读模式的叶子文档；path 为绝对路径（同 ReadingDoc 的打开键）。 */
export interface BookChapter {
  title: string;
  path: string;
  format: ReadingFormat;
}

/** 卷：文件夹书的一级子目录；单卷书亦归一卷。 */
export interface BookVolume {
  title: string;
  chapters: BookChapter[];
}

/** 一本书（书架条目）。 */
export interface Book {
  /** 稳定 id：由 rootPath 派生（重复导入幂等去重，亦作「是否已在架」判定键）。 */
  id: string;
  title: string;
  /** 封面 data: URI（epub 提取 / 其它生成占位）；缺省由 UI 兜底。 */
  cover?: string;
  kind: BookKind;
  /** 导入的文件或文件夹绝对路径。 */
  rootPath: string;
  /** 代表格式（文件书=该文件；文件夹书=首章格式），用于封面角标。 */
  format: ReadingFormat;
  /** 卷-章结构（单文件 = 1 卷 1 章 = rootPath）。 */
  volumes: BookVolume[];
  addedAt: number;
  lastOpenedAt?: number;
}

/** 阅读进度：每个叶子文档一条，按绝对路径键存；与是否在架无关，始终记录。 */
export interface ReadingProgress {
  /** 0..1 进度分数（由章/页推导，供画廊进度条与「续读 X%」提示）。 */
  fraction: number;
  /** 当前章索引（PDF 为页号-1）；单文档为 0。 */
  index: number;
  /** 总章节数（PDF 为总页数）。 */
  total: number;
  updatedAt: number;
}

/** 书架盘契约（app-data/bookshelf.json，tauri-plugin-store）。progress 独立于 books（未上架也记）。 */
export interface PersistedBookshelf {
  version: 1;
  books: Book[];
  progress: Record<string, ReadingProgress>;
}

/** list_dir_tree 返回的目录树节点（Rust bookshelf::DirEntry 映射，文件夹导入用）。 */
export interface DirTreeEntry {
  name: string;
  path: string;
  isDir: boolean;
  children: DirTreeEntry[];
}
