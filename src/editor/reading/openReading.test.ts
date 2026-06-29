import { describe, expect, it } from 'vitest';
import { isAutoReadingFormat, isShelfFormat, readingFormatOf } from './openReading';

describe('reading 格式判定', () => {
  it('按扩展名（大小写不敏感）映射格式', () => {
    expect(readingFormatOf('dir/Book.PDF')).toBe('pdf');
    expect(readingFormatOf('a.epub')).toBe('epub');
    expect(readingFormatOf('a.docx')).toBe('docx');
    expect(readingFormatOf('a.txt')).toBe('txt');
    expect(readingFormatOf('a.md')).toBe('md');
    expect(readingFormatOf('note.markdown')).toBe('md');
    expect(readingFormatOf('noext')).toBeNull();
  });

  it('docx/epub/pdf 自动进阅读；txt/md 不自动（可编辑）', () => {
    expect(isAutoReadingFormat('a.pdf')).toBe(true);
    expect(isAutoReadingFormat('a.epub')).toBe(true);
    expect(isAutoReadingFormat('a.docx')).toBe(true);
    expect(isAutoReadingFormat('a.txt')).toBe(false);
    expect(isAutoReadingFormat('a.md')).toBe(false);
  });

  it('md 可阅读但不入书架：isShelfFormat 排除 md 与非阅读格式', () => {
    expect(isShelfFormat('a.txt')).toBe(true);
    expect(isShelfFormat('a.docx')).toBe(true);
    expect(isShelfFormat('a.epub')).toBe(true);
    expect(isShelfFormat('a.pdf')).toBe(true);
    expect(isShelfFormat('a.md')).toBe(false); // 可进阅读（readingFormatOf 返 'md'）但不作书目
    expect(isShelfFormat('note.markdown')).toBe(false);
    expect(isShelfFormat('noext')).toBe(false);
  });
});
