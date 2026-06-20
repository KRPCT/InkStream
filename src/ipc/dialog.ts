import { open, save } from '@tauri-apps/plugin-dialog';
import type { PandocFormat } from '../types/export';

/**
 * 原生系统对话框前端通道（R4 §2）。全项目唯一接触 @tauri-apps/plugin-dialog 的文件
 * （ipc/ 收口立约）：业务代码经此调用，不直接 import @tauri-apps/*。
 *
 * 权限面：capability 授 `dialog:allow-open` 与 `dialog:allow-save`（最小权限）。
 * 「打开」族返回的路径仍交 Rust 端 vault/files command 的 path_guard 收口校验；
 * 「保存」返回的绝对路径属用户显式授权边界（草稿另存为，走 write_file_to_path）。
 */

/** 仅 Markdown / 纯文本文件过滤（保存用；无 `.` 前缀，跨平台 OS 原生过滤器）。 */
const MARKDOWN_FILTER = {
  name: 'Markdown',
  extensions: ['md', 'markdown', 'txt'],
};

/** 打开过滤：可编辑（md/txt）+ 阅读模式（docx/epub/pdf），后者打开即进沉浸阅读覆盖层。 */
const OPENABLE_FILTER = {
  name: '可打开文档',
  extensions: ['md', 'markdown', 'txt', 'docx', 'epub', 'pdf'],
};

/** 文件导出保存过滤器（按格式；PDF 走打印对话框无需此路）。pandoc 格式仅在系统装有 pandoc 时被调用。 */
const EXPORT_FILTERS: Record<'html' | 'docx' | PandocFormat, { name: string; extensions: string[] }> = {
  html: { name: 'HTML', extensions: ['html'] },
  docx: { name: 'Word 文档', extensions: ['docx'] },
  odt: { name: 'OpenDocument 文本', extensions: ['odt'] },
  rtf: { name: 'RTF', extensions: ['rtf'] },
  latex: { name: 'LaTeX', extensions: ['tex'] },
  epub: { name: 'EPUB', extensions: ['epub'] },
  typst: { name: 'Typst', extensions: ['typ'] },
  org: { name: 'Org', extensions: ['org'] },
};

/**
 * 打开目录选择对话框（资源管理器风格）。取消返回 null。
 * `multiple: false` 保证返回单一字符串（OpenDialogReturn 收窄为 `string | null`）。
 */
export function pickFolder(): Promise<string | null> {
  return open({ directory: true, multiple: false });
}

/**
 * 打开文件选择对话框，过滤 Markdown / 纯文本。取消返回 null。
 * `directory: false` + `multiple: false` 返回单一文件绝对路径。
 */
export function pickFile(): Promise<string | null> {
  return open({ directory: false, multiple: false, filters: [OPENABLE_FILTER] });
}

/**
 * 原生保存对话框（草稿另存为转正用）：defaultName 预填文件名。取消返回 null。
 * 返回的绝对路径是用户显式授权的写入位置（不经 vault path_guard）。
 */
export function pickSavePath(defaultName: string): Promise<string | null> {
  return save({ defaultPath: defaultName, filters: [MARKDOWN_FILTER] });
}

/**
 * 文件导出保存对话框（HTML / DOCX）：defaultName 预填带扩展名的文件名，按格式过滤。取消返回 null。
 * 返回绝对路径走 writeFileToPath（HTML 文本）/ writeBytesToPath（DOCX 二进制），不经 vault path_guard。
 */
export function pickExportPath(
  defaultName: string,
  format: 'html' | 'docx' | PandocFormat,
): Promise<string | null> {
  return save({ defaultPath: defaultName, filters: [EXPORT_FILTERS[format]] });
}
