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
