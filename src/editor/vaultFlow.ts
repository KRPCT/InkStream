import { startWatch, stopWatch } from '../ipc/events';
import { listDir, listFiles, openVault } from '../ipc/vault';
import { openFolderDialog } from '../stores/useOpenFolderStore';
import { showToast } from '../stores/useToastStore';
import { useGitGuidanceStore } from '../stores/useGitGuidanceStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { VaultInfo } from '../types/vault';
import { entriesToNodes } from './fileTreeData';

/**
 * vault 生命周期编排（非 React 模块，经 getState() 调用）：打开 / 切换 / 引导。
 *
 * 受控树纯数据拆至 fileTreeData，文件打开编排拆至 fileOpenFlow（289 行超限拆三块，本体留生命周期）。
 * 文件夹选择对话框：本阶段拒引未审计 tauri-plugin-dialog（Phase 1 取向），改自绘路径输入对话框。
 */

/** vault 语义引导（D-05/D-06）：非 git → 引导 git init 条；git 子目录 → 仓库根选择对话框。 */
function applyGitGuidance(info: VaultInfo): void {
  const guidance = useGitGuidanceStore.getState();
  if (info.repoRoot === null) {
    // D-05：非 git 仓库，引导 git init（可跳过，git 功能置灰至 Phase 6）
    guidance.showInitGuidance(info.root);
  } else if (info.repoRoot !== info.root) {
    // D-06：打开的是 git 仓库子目录，提示「打开仓库根 / 仅此文件夹」
    guidance.showSubdirChoice(info.root, info.repoRoot);
  } else {
    guidance.dismiss();
  }
}

/** 打开给定路径为 vault：openVault + listDir 根目录 → useVaultStore.openVault。 */
export async function openVaultByPath(path: string): Promise<void> {
  try {
    const info = await openVault(path);
    useVaultStore.getState().openVault(info, entriesToNodes(await listDir(info.root, '')));
    useVaultStore.getState().pushRecent(info.root);
    useVaultStore.getState().setLastVaultPath(info.root);
    applyGitGuidance(info);
    // 快速打开（Ctrl+P，FILE-03）文件清单快照：fileProvider 同步消费此 store 快照。
    // 枚举失败不阻断打开 vault——快速打开仅暂无结果，文件树仍可用。
    try {
      useVaultStore.getState().setFiles(await listFiles(info.root));
    } catch {
      useVaultStore.getState().setFiles([]);
    }
  } catch (e) {
    showToast('error', '无法打开这个文件夹，它可能已被移动或删除。');
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * 切换 vault（同窗单 vault，D-07）：stop_watch 旧 → open_vault 新 → start_watch 新。
 *
 * 切 vault 时停旧 watcher、打开新 vault、为新根启动 watcher（FILE-02 外部变更监听）。
 * 打开失败回退（保留旧 vault），并提示。
 */
export async function switchVault(path: string): Promise<void> {
  try {
    await stopWatch();
  } catch {
    /* 停旧 watcher 失败不阻断切换 */
  }
  await openVaultByPath(path);
  const root = useVaultStore.getState().vault?.root;
  if (root) {
    try {
      await startWatch(root);
    } catch {
      /* watcher 启动失败：外部变更监听不可用，文件树仍可用 */
    }
  }
}

/**
 * 「打开最近」命令入口（D-07）：当前仅经命令面板列出最近，UI 选择走 Sidebar 最近列表。
 * 原生 picker 落地前给出提示，不静默吞操作。
 */
export async function requestOpenRecent(): Promise<void> {
  const recent = useVaultStore.getState().recentVaults;
  if (recent.length === 0) {
    showToast('warning', '还没有最近打开的工作区。');
    return;
  }
  showToast('warning', '在侧栏空态的「最近打开」列表中选择工作区即可重新打开。');
}

/**
 * 「打开文件夹」命令入口（命令面板 / 空态按钮 / EditorArea 按钮 / file.open-folder 触发）。
 *
 * 拒引未审计 tauri-plugin-dialog（Phase 1 取向），改自绘路径输入对话框（openFolderDialog）：
 * 用户粘贴/输入绝对路径 → switchVault（与 RecentVaults 同链路，停旧 watcher → 开新 vault →
 * 启用文件监听）。取消 / 空路径静默 no-op；打开失败的提示由 openVaultByPath 内的 toast 兜底。
 */
export async function requestOpenFolder(): Promise<void> {
  const path = await openFolderDialog();
  if (path === null) return;
  const trimmed = path.trim();
  if (trimmed.length === 0) return;
  try {
    await switchVault(trimmed);
  } catch {
    /* openVaultByPath 已弹错误 toast，此处吞掉避免未处理拒绝 */
  }
}
