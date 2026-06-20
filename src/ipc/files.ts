import type { DirTreeEntry } from '../types/bookshelf';
import { invoke } from './invoke';

/**
 * 文件读写 command 前端通道。全项目唯一接触 files 相关 Rust command 的文件之一
 * （ipc/ 收口立约）：业务代码经此调用，不直接 import @tauri-apps/api。
 */

/**
 * 读取 vault 内某文件为 UTF-8 文本（root 为 vault 根绝对路径，path 相对 root）。
 *
 * 红线：负载 > 1MB（1,048,576 字节）应改走 invokeStreamed（Channel 流式，见 invoke.ts）。
 * 本阶段以普通 invoke 实现，Channel 流式留待 02-03 出现真实大文件时落地。
 */
export function readFile(root: string, path: string): Promise<string> {
  return invoke('read_file', { root, path });
}

/**
 * 原子写（temp + rename，T-02-07）：写中途崩溃只丢 temp，原文件不动。
 * 自动保存防抖落盘与 Ctrl+S 立即落盘均经此。
 */
export function writeFileAtomic(root: string, path: string, content: string): Promise<null> {
  return invoke('write_file_atomic', { root, path, content });
}

/**
 * 草稿另存为：绝对路径原子写（temp+fsync+rename，与 writeFileAtomic 同核）。
 * path 来自原生保存对话框，属用户显式授权边界，Rust 侧不经 vault path_guard（无 root 语义）。
 */
export function writeFileToPath(path: string, content: string): Promise<null> {
  return invoke('write_file_to_path', { path, content });
}

/**
 * 导出二进制文件到绝对路径（DOCX 等）：path 来自原生保存对话框（用户显式授权边界）。
 * content 为字节，序列化为 number[] 过 IPC（Tauri → Rust Vec<u8>）。文本导出（HTML）仍走 writeFileToPath。
 */
export function writeBytesToPath(path: string, content: Uint8Array): Promise<null> {
  return invoke('write_file_bytes', { path, content: Array.from(content) });
}

/**
 * 阅读模式：读绝对路径文件为字节（DOCX/EPUB/PDF 二进制）。readFile 仅 UTF-8 文本，二进制经其会损坏。
 * 大文件（>1MB）一次性过 IPC 有主线程成本（红线见本文件头）；阅读期一次读入可接受，超大文档后续可下沉 Channel。
 */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke('read_file_bytes', { path }));
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
