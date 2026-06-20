import type { Book, BookChapter, BookVolume, PersistedBookshelf, ReadingProgress } from '../types/bookshelf';
import type { ReadingFormat } from '../types/reading';

/**
 * 书架盘数据手写窄校验（同 validateSettings 纪律：不引 zod，永不抛，坏数据回退默认）。
 * 盘上数据不可信（人为篡改 / 旧版本 / 损坏）：逐字段过滤，结构不符即丢该条。
 */
const FORMATS: ReadingFormat[] = ['txt', 'docx', 'epub', 'pdf'];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): v is string => typeof v === 'string';
const fmt = (v: unknown): v is ReadingFormat => FORMATS.includes(v as ReadingFormat);

export function bookshelfDefaults(): PersistedBookshelf {
  return { version: 1, books: [], progress: {} };
}

function validChapter(raw: unknown): BookChapter | null {
  if (!isRecord(raw) || !str(raw.title) || !str(raw.path) || !fmt(raw.format)) return null;
  return { title: raw.title, path: raw.path, format: raw.format };
}

function validVolume(raw: unknown): BookVolume | null {
  if (!isRecord(raw) || !str(raw.title) || !Array.isArray(raw.chapters)) return null;
  const chapters = raw.chapters.map(validChapter).filter((c): c is BookChapter => c !== null);
  return chapters.length ? { title: raw.title, chapters } : null;
}

function validBook(raw: unknown): Book | null {
  if (!isRecord(raw) || !str(raw.id) || !str(raw.title) || !str(raw.rootPath) || !fmt(raw.format)) return null;
  if (raw.kind !== 'file' && raw.kind !== 'folder' || !Array.isArray(raw.volumes)) return null;
  const volumes = raw.volumes.map(validVolume).filter((v): v is BookVolume => v !== null);
  if (!volumes.length) return null;
  return {
    id: raw.id,
    title: raw.title,
    cover: str(raw.cover) ? raw.cover : undefined,
    kind: raw.kind,
    rootPath: raw.rootPath,
    format: raw.format,
    volumes,
    addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
    lastOpenedAt: typeof raw.lastOpenedAt === 'number' ? raw.lastOpenedAt : undefined,
  };
}

function validProgress(raw: unknown): ReadingProgress | null {
  if (!isRecord(raw)) return null;
  const { fraction, index, total, updatedAt } = raw;
  if (typeof fraction !== 'number' || typeof index !== 'number' || typeof total !== 'number') return null;
  return {
    fraction: Math.min(1, Math.max(0, fraction)),
    index: Math.max(0, Math.floor(index)),
    total: Math.max(1, Math.floor(total)),
    updatedAt: typeof updatedAt === 'number' ? updatedAt : Date.now(),
  };
}

export function validateBookshelf(raw: unknown): PersistedBookshelf {
  if (!isRecord(raw) || raw.version !== 1) return bookshelfDefaults();
  const books = Array.isArray(raw.books) ? raw.books.map(validBook).filter((b): b is Book => b !== null) : [];
  const progress: Record<string, ReadingProgress> = {};
  if (isRecord(raw.progress)) {
    for (const [k, v] of Object.entries(raw.progress)) {
      const p = validProgress(v);
      if (p) progress[k] = p;
    }
  }
  return { version: 1, books, progress };
}
