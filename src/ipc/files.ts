import type { DirTreeEntry } from '../types/bookshelf';
import type { FileReadOptions } from '../types/fileTransfer';
import { invoke } from './invoke';
import { readBytesStream, readTextStream } from './fileStream';
import { writeBytesRaw, writeTextRaw } from './fileWrite';

/**
 * 文件读写 command 前端通道。全项目唯一接触 files 相关 Rust command 的文件之一
 * （ipc/ 收口立约）：业务代码经此调用，不直接 import @tauri-apps/api。
 */

/**
 * 读取 vault 内某文件为 UTF-8 文本（root 为 vault 根绝对路径，path 相对 root）。
 *
 * 使用有界Raw分块，UTF-8/长度/顺序全部验证完成才返回；取消不会返回部分正文。
 */
export function readFile(root: string, path: string, options?: FileReadOptions): Promise<string> {
  return readTextStream({ kind: 'text', root, path }, options);
}

/**
 * 原子写（temp + rename，T-02-07）：写中途崩溃只丢 temp，原文件不动。
 * 自动保存防抖落盘与 Ctrl+S 立即落盘均经此。
 */
export function writeFileAtomic(root: string, path: string, content: string): Promise<null> {
  return writeTextRaw({ kind: 'vault', root, path }, content);
}

/**
 * 草稿另存为：绝对路径原子写（temp+fsync+rename，与 writeFileAtomic 同核）。
 * path 来自原生保存对话框，属用户显式授权边界，Rust 侧不经 vault path_guard（无 root 语义）。
 */
export function writeFileToPath(path: string, content: string): Promise<null> {
  return writeTextRaw({ kind: 'absolute', path }, content);
}

/**
 * 导出二进制文件到绝对路径（DOCX 等）：path 来自原生保存对话框（用户显式授权边界）。
 * content 保留视图范围并作为 Raw 正文传输。文本导出（HTML）仍走 writeFileToPath。
 */
export function writeBytesToPath(path: string, content: Uint8Array): Promise<null> {
  return writeBytesRaw({ kind: 'absolute', path }, content);
}

/**
 * 阅读模式：读绝对路径文件为字节（DOCX/EPUB/PDF 二进制）。readFile 仅 UTF-8 文本，二进制经其会损坏。
 * 原始字节按块传输并组装；原生端仍限制阅读格式与100MiB上限。
 */
export function readFileBytes(path: string, options?: FileReadOptions): Promise<Uint8Array> {
  return readBytesStream({ kind: 'reading', path }, options);
}

/**
 * 导出内嵌：读绝对路径图片为字节（→ data URI 内嵌进 HTML/PDF/DOCX 导出产物）。
 * 调用前须经 resolveVaultImage 判定路径在 vault 内（承 ImageWidget 安全边界）；Rust 侧再以图片扩展名白名单兜底。
 */
export function readImageBytes(path: string, options?: FileReadOptions): Promise<Uint8Array> {
  return readBytesStream({ kind: 'image', path }, options);
}

/** 新建空文件：同名已存在则 Rust 侧返回错误，绝不覆盖（D-12）。 */
export function createFile(root: string, path: string): Promise<null> {
  return invoke('create_file', { root, path });
}

/** 新建目录：同名已存在则 Rust 侧返回错误。 */
export function createDir(root: string, path: string): Promise<null> {
  return invoke('create_dir', { root, path });
}

/** 重命名：目的地已存在则 Rust 侧返回错误（绝不覆盖）。 */
export function renamePath(root: string, from: string, to: string): Promise<null> {
  return invoke('rename_path', { root, from, to });
}

/** 移动：目的地已存在同名项则 Rust 侧返回错误。 */
export function movePath(root: string, from: string, to: string): Promise<null> {
  return invoke('move_path', { root, from, to });
}

/** 删除到系统回收站（D-09）。 */
export function trashPath(root: string, path: string): Promise<null> {
  return invoke('trash_path', { root, path });
}

/** 书架文件夹导入：读绝对路径文件夹的书籍目录树（书→卷→章，只读，深度封顶）。 */
export function listDirTree(path: string): Promise<DirTreeEntry> {
  return invoke('list_dir_tree', { path });
}
