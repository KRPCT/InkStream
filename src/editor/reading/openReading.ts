import { useReadingStore } from '../../stores/useReadingStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { useWorkbenchStore } from '../../stores/useWorkbenchStore';
import type { ReadingFormat } from '../../types/reading';
import { isAbsolutePath, stripVerbatim } from '../pathUtil';

/**
 * 阅读模式进出编排（FEAT-READ）：扩展名判格式 + 打开覆盖层 + 解析当前编辑器文件为绝对路径。
 * 二进制（docx/epub/pdf）自动进阅读（不可编辑）；txt 默认留编辑器，经命令显式进阅读。
 */

const EXT_FORMAT: Record<string, ReadingFormat> = {
  txt: 'txt', docx: 'docx', epub: 'epub', pdf: 'pdf',
};

/** 扩展名 → 阅读格式（不支持返回 null）。 */
export function readingFormatOf(path: string): ReadingFormat | null {
  return EXT_FORMAT[path.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

/** 是否「打开即自动进阅读」的二进制格式（txt 不算——它可编辑）。 */
export function isAutoReadingFormat(path: string): boolean {
  const f = readingFormatOf(path);
  return f === 'docx' || f === 'epub' || f === 'pdf';
}

/** 打开绝对路径文件进入阅读模式覆盖层。直接打开（非书架）清空章节上下文。 */
export function openReading(absPath: string, name: string): void {
  const format = readingFormatOf(absPath);
  if (!format) return;
  useReadingStore.getState().setBookContext(null);
  useReadingStore.getState().setDoc({ path: absPath, name, format });
  useWorkbenchStore.getState().setCentralView('reading');
}

/** 关闭阅读模式回编辑器（裸拆卸；书架「加入书架」提示见 bookshelf/exitReading）。 */
export function closeReading(): void {
  useWorkbenchStore.getState().setCentralView('editor');
  useReadingStore.getState().setDoc(null);
  useReadingStore.getState().setBookContext(null);
}

/**
 * 把活动编辑器文件在阅读模式打开（命令入口）：vault 内相对路径拼成绝对（readFileBytes 需绝对路径），
 * external tab 本就是绝对路径。无活动文件 / 不支持的格式则 no-op（命令侧已守卫）。
 */
export function openActiveInReading(activePath: string, name: string): void {
  const root = useVaultStore.getState().vault?.root ?? null;
  // 库内相对 → 拼干净的 vault 根（stripVerbatim 去 Windows \\?\，避免 readFileBytes 收到含 verbatim 的脏路径）。
  const abs =
    isAbsolutePath(activePath) || !root ? activePath : `${stripVerbatim(root)}/${activePath}`;
  openReading(stripVerbatim(abs), name);
}
