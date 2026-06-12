import { pickFile, pickFolder } from '../ipc/dialog';
import { startWatch, stopWatch } from '../ipc/events';
import { listDir, listFiles, openVault } from '../ipc/vault';
import { showToast } from '../stores/useToastStore';
import { useGitGuidanceStore } from '../stores/useGitGuidanceStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { VaultInfo } from '../types/vault';
import { entriesToNodes } from './fileTreeData';
import { openFileByPath } from './fileOpenFlow';

/**
 * vault 生命周期编排（非 React 模块，经 getState() 调用）：打开 / 切换 / 引导。
 *
 * 受控树纯数据拆至 fileTreeData，文件打开编排拆至 fileOpenFlow（289 行超限拆三块，本体留生命周期）。
 * 文件/文件夹选择对话框：R4 §2 反转旧自绘决策，改原生系统对话框（ipc/dialog，最小权限 allow-open）。
 */

/** 路径分隔统一为 `/` 并剥除末尾分隔，取父目录（vault 外文件 → 其父目录作 vault）。 */
export function parentDir(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const i = norm.lastIndexOf('/');
  return i <= 0 ? norm : norm.slice(0, i);
}

/** 判断文件是否落在当前已打开 vault 根内（同根 → 直接打开，无需切 vault）。 */
export function relativeWithinVault(filePath: string, root: string): string | null {
  const normFile = filePath.replace(/\\/g, '/');
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normFile === normRoot) return null;
  const prefix = `${normRoot}/`;
  return normFile.startsWith(prefix) ? normFile.slice(prefix.length) : null;
}

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
 * 「打开最近」命令入口（D-07）：恰好一个最近项时直接重开；多项时提示去侧栏/文件菜单子菜单选。
 * 菜单栏「最近打开 ▸」子菜单逐项直连 switchVault（MenuBar 动态构建），此命令为命令面板兜底。
 */
export async function requestOpenRecent(): Promise<void> {
  const recent = useVaultStore.getState().recentVaults;
  if (recent.length === 0) {
    showToast('warning', '还没有最近打开的工作区。');
    return;
  }
  if (recent.length === 1) {
    await switchVault(recent[0]);
    return;
  }
  showToast('warning', '在「文件 → 最近打开」子菜单或侧栏空态列表中选择工作区即可重新打开。');
}

/**
 * 「打开文件夹」命令入口（命令面板 / 空态按钮 / EditorArea 按钮 / file.open-folder 触发）。
 *
 * R4 §2：原生目录选择对话框（pickFolder，资源管理器风格）→ switchVault（与 RecentVaults 同链路，
 * 停旧 watcher → 开新 vault → 启用文件监听）。取消静默 no-op；打开失败的提示由 openVaultByPath 兜底。
 */
export async function requestOpenFolder(): Promise<void> {
  const path = await pickFolder();
  if (path === null) return;
  try {
    await switchVault(path);
  } catch {
    /* openVaultByPath 已弹错误 toast，此处吞掉避免未处理拒绝 */
  }
}

/**
 * 「打开文件」命令入口（file.open-file，Ctrl+O 触发）。
 *
 * R4 §2：原生文件选择对话框（pickFile，过滤 Markdown/txt）。选中文件：
 * - 在当前 vault 内 → 直接以相对路径打开（openFileByPath，复用单内核换装链路）；
 * - 在 vault 外（或尚无 vault） → switchVault 到其父目录后，以文件名相对路径打开。
 * 取消静默 no-op；读文件失败的提示由 openFileInEditor 内 toast 兜底。
 */
export async function requestOpenFile(): Promise<void> {
  const path = await pickFile();
  if (path === null) return;
  const root = useVaultStore.getState().vault?.root;
  if (root) {
    const rel = relativeWithinVault(path, root);
    if (rel !== null) {
      await openFileByPath(rel);
      return;
    }
  }
  // vault 外：切到父目录作 vault，再按文件名打开（switchVault 失败已弹 toast）。
  const dir = parentDir(path);
  const name = path.replace(/\\/g, '/').split('/').pop() ?? path;
  try {
    await switchVault(dir);
  } catch {
    return;
  }
  await openFileByPath(name);
}
