import type { PandocFormat } from '../../types/export';

/**
 * pandoc 导出格式表（FEAT-EXPORT）：id = pandoc --to 值 = 命令 / 对话框键；ext = 文件扩展名；label = 显示名。
 * 不含 PDF（pandoc-PDF 需 LaTeX/typst 引擎，且内置已有打印 PDF）。
 */
export interface PandocFormatSpec {
  id: PandocFormat;
  label: string;
  ext: string;
}

export const PANDOC_FORMATS: readonly PandocFormatSpec[] = [
  { id: 'odt', label: 'ODT', ext: 'odt' },
  { id: 'rtf', label: 'RTF', ext: 'rtf' },
  { id: 'latex', label: 'LaTeX', ext: 'tex' },
  { id: 'epub', label: 'EPUB', ext: 'epub' },
  { id: 'typst', label: 'Typst', ext: 'typ' },
  { id: 'org', label: 'Org', ext: 'org' },
];
