import { PANDOC_FORMATS } from '../editor/export/pandocFormats';
import { exportDocument, exportViaPandoc } from '../editor/export/runExport';
import type { Command } from '../types/commands';

/**
 * 文件导出命令（FEAT-EXPORT）：TitleBar 文件菜单「导出为」子菜单 + 命令面板入口，导出当前文档。
 * 内置 HTML / PDF / DOCX 始终可用（非 advanced）；pandoc 格式（odt/rtf/latex/epub/typst/org）标 pandocOnly，
 * 仅系统装有 pandoc 时显示。
 */
export const EXPORT_COMMANDS: Command[] = [
  { id: 'file.export-html', title: '文件：导出为 HTML', run: () => void exportDocument('html') },
  { id: 'file.export-pdf', title: '文件：导出为 PDF', run: () => void exportDocument('pdf') },
  { id: 'file.export-docx', title: '文件：导出为 DOCX', run: () => void exportDocument('docx') },
  ...PANDOC_FORMATS.map(
    (f): Command => ({
      id: `file.export-${f.id}`,
      title: `文件：导出为 ${f.label}（pandoc）`,
      pandocOnly: true,
      run: () => void exportViaPandoc(f.id),
    }),
  ),
];
