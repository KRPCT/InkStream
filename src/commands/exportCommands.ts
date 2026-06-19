import { exportDocument } from '../editor/export/runExport';
import type { Command } from '../types/commands';

/**
 * 文件导出命令（FEAT-EXPORT）：TitleBar 文件菜单「导出为」子菜单 + 命令面板入口，导出当前文档为
 * HTML / PDF / DOCX。非 advanced——基础能力，简易模式下仍可用。
 */
export const EXPORT_COMMANDS: Command[] = [
  { id: 'file.export-html', title: '文件：导出为 HTML', run: () => void exportDocument('html') },
  { id: 'file.export-pdf', title: '文件：导出为 PDF', run: () => void exportDocument('pdf') },
  { id: 'file.export-docx', title: '文件：导出为 DOCX', run: () => void exportDocument('docx') },
];
