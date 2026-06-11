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
