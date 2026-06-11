import type { TreeEntry, VaultInfo } from '../types/vault';
import { invoke } from './invoke';

/**
 * vault command 前端通道。全项目唯一接触 vault 相关 Rust command 的文件之一
 * （ipc/ 收口立约）：业务代码经此调用，不直接 import @tauri-apps/api。
 */

/** 打开文件夹为 vault：规范化 + 探测仓库根 + 取名（D-05/D-07）。 */
export function openVault(path: string): Promise<VaultInfo> {
  return invoke('open_vault', { path });
}

/** 列出 vault 内某相对目录的直接子项（root 为 vault 根绝对路径，rel 根目录传 ""）。 */
export function listDir(root: string, rel: string): Promise<TreeEntry[]> {
  return invoke('list_dir', { root, rel });
}

/** 从任意路径向上找仓库根（D-06 子目录场景）；非 git 返回 null。 */
export function findRepoRoot(path: string): Promise<string | null> {
  return invoke('find_repo_root', { path });
}
