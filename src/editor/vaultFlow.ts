import { pickFile, pickFolder } from '../ipc/dialog';
import { indexRebuild } from '../ipc/indexService';
import { listDir, listFiles, openVault } from '../ipc/vault';
import { chooseAction } from '../stores/useChoiceStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { showToast } from '../stores/useToastStore';
import { useGitGuidanceStore } from '../stores/useGitGuidanceStore';
import { useGitStore } from '../stores/useGitStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { VaultInfo } from '../types/vault';
import { refreshCodex } from './codex';
import { entriesToNodes } from './fileTreeData';
import { openExternalFile } from './fileOpenFlow';
import { basename, stripVerbatim } from './pathUtil';
import { isAutoReadingFormat, openReading } from './reading/openReading';
import { commitChanges } from './gitActions';

/**
 * vault 生命周期编排（非 React 模块，经 getState() 调用）：打开 / 切换 / 引导。
 *
 * 受控树纯数据拆至 fileTreeData，文件打开编排拆至 fileOpenFlow（289 行超限拆三块，本体留生命周期）。
 * 文件/文件夹选择对话框：R4 §2 反转旧自绘决策，改原生系统对话框（ipc/dialog，最小权限 allow-open）。
 */

// 纯路径工具下沉 pathUtil（叶子，无环）；此处再导出保 draftFlow 等既有 import 兼容。
export { parentDir, relativeWithin as relativeWithinVault } from './pathUtil';

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
export async function prepareVault(path: string) {
  try {
    const info = await openVault(path);
    const tree = entriesToNodes(await listDir(info.root, ''));
    const files = await listFiles(info.root);
    return { info, tree, files };
  } catch (error) {
    showToast('error', '无法打开这个文件夹，它可能已被移动或删除。');
    throw error;
  }
}

export function publishVault({ info, tree, files }: Awaited<ReturnType<typeof prepareVault>>): void {
    useVaultStore.setState({ vault: info, tree, files, expanded: new Set() });
    useVaultStore.getState().pushRecent(info.root);
    useVaultStore.getState().setLastVaultPath(info.root);
    applyGitGuidance(info);
    // Phase 6 GIT-01：设 git 仓库根并刷新（status + branches）→ StatusBar 分支指示上屏。
    // 非 git 工作区 repoRoot 为 null，store 清空、指示器隐藏（与 applyGitGuidance 的 init 引导协同）。
    useGitStore.getState().setRepoRoot(info.repoRoot);
    // 快速打开与文件树使用准备阶段成功获取的同一工作区快照。
    // 索引位置由原生项目仓储返回，位于应用数据目录；简易模式关闭索引。
    if (!useSettingsStore.getState().simpleMode) void indexRebuild(info.root).catch(() => {});
    // CREA-02：扫 Codex/ 文献条目供提及高亮（fire-and-forget，无 Codex/ 即空，不阻断打开）。
    void refreshCodex(info.root).catch(() => {});
}

/** All directory entry points share the same transition and recovery protocol. */
export async function openVaultByPath(path: string): Promise<void> {
  await switchVault(path, { confirmLeave: false });
}

/**
 * 切库前的「未提交提示」（#5.4）：当前工作区 git 有未提交改动时，提示「提交并切换 / 直接切换 / 取消」。
 * external tab 模型下切库已非破坏操作（文件不丢），故这是版本卫生提示：取消则不切，其余均继续切。
 * 非 git / 无改动 → 直接放行。
 */
async function confirmLeaveDirtyVault(): Promise<boolean> {
  const git = useGitStore.getState();
  const count = git.repoRoot !== null ? (git.status?.files.length ?? 0) : 0;
  if (count === 0) return true;
  const choice = await chooseAction({
    title: '当前工作区有未提交更改',
    body: `当前工作区有 ${count} 个文件的更改尚未提交。切换工作区后这些文件仍保留在磁盘、不会丢失，但不在当前仓库的 git 历史中。`,
    options: [
      { id: 'switch', label: '直接切换' },
      { id: 'commit', label: '提交并切换', kind: 'primary' },
    ],
  });
  if (choice === null) return false; // 取消 → 不切换
  if (choice === 'commit') await commitChanges(); // 弹信息输入并提交；取消输入/失败仍继续切（文件已在盘、安全）
  return true;
}

/** Directory entry points register stable projects and use the shared session transaction. */
export async function switchVault(path: string, options?: { confirmLeave?: boolean }): Promise<boolean> {
  if (options?.confirmLeave !== false && !(await confirmLeaveDirtyVault())) return false;
  const { openProjectDirectory } = await import('../projects/actions');
  return openProjectDirectory(path);
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
 * R4 §2：原生文件选择对话框（pickFile，过滤 Markdown/txt）。选中文件经 openExternalFile：
 * - 在当前 vault 内 → 相对路径打开（库内 tab）；
 * - 在 vault 外 → external（非工作区）tab，**不切换工作区**（#5.1）。
 * 取消静默 no-op；读文件失败的提示由 openExternalFile 内 toast 兜底。
 */
export async function requestOpenFile(): Promise<void> {
  const path = await pickFile();
  if (path === null) return;
  // docx/epub/pdf → 阅读模式覆盖层（不可编辑）；md/markdown/txt → 编辑器。
  if (isAutoReadingFormat(path)) {
    const clean = stripVerbatim(path);
    openReading(clean, basename(clean));
    return;
  }
  await openExternalFile(path);
}
