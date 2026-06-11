import type { FileEntry, TreeEntry, VaultInfo } from '../types/vault';
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

/**
 * 递归枚举 vault 内全部文件清单（快速打开 Ctrl+P 数据源，FILE-03）。
 *
 * 跳过 .git 等点开头目录（D-11）。红线：超大 vault 清单理论上可能越 1MB 单次 invoke
 * 桥红线（T-02-20 accept）；本阶段普通 invoke 返回，真实大 vault 卡顿时改走 invokeStreamed
 * Channel 流式（与 02-01 list_dir / 02-03 read_file 同策略）。
 */
export function listFiles(root: string): Promise<FileEntry[]> {
  return invoke('list_files', { root });
}

/** 从任意路径向上找仓库根（D-06 子目录场景）；非 git 返回 null。 */
export function findRepoRoot(path: string): Promise<string | null> {
  return invoke('find_repo_root', { path });
}
