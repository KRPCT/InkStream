import type { EditorView } from '@codemirror/view';
import { startWatch, stopWatch } from '../ipc/events';
import { readFile } from '../ipc/files';
import { listDir, listFiles, openVault } from '../ipc/vault';
import { getView } from './viewHandle';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useGitGuidanceStore } from '../stores/useGitGuidanceStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { TreeEntry, TreeNode, VaultInfo } from '../types/vault';
import { baseExtensions } from './extensions';
import { languageFromDoc, markAppliedLanguage } from './languages';
import { openFile, snapshotBeforeSwitch } from './editorState';

/**
 * 打开文件夹 → 文件树 → 点击打开 的端到端编排（非 React 模块，经 getState() 调用）。
 *
 * 文件夹选择对话框：本阶段拒引未审计 tauri-plugin-dialog（Phase 1 取向），原生
 * 文件夹选择对话框接入记为 02-03 待办。openVaultByPath 接受已知路径，UI 暂经命令面板
 * 与测试注入驱动端到端（详见 SUMMARY 标注）。
 */

/** 文件夹优先 + Intl.Collator locale 排序（D-11：中文按拼音序）。 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 扁平 TreeEntry[] 排序并转 react-arborist 受控 data（顶层；子目录懒加载留 02-03）。 */
export function entriesToNodes(entries: TreeEntry[]): TreeNode[] {
  return [...entries]
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1; // 文件夹优先
      return collator.compare(a.name, b.name);
    })
    .map((e) => ({
      id: e.path,
      name: e.name,
      isDir: e.isDir,
      // 目录给空 children 数组让 react-arborist 视其为可展开（子项懒加载属 02-03）
      ...(e.isDir ? { children: [] as TreeNode[] } : {}),
    }));
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
 * 重新枚举当前 vault 根目录 → 回流 useVaultStore.tree + files 快照（FILE-01 写操作后 /
 * watcher 外部变更后调用）。无 vault 时静默 no-op。
 *
 * 受控 data 刷新（A2/Pitfall 5）：写操作成功后回流真相树，与 watcher 外部刷新同一入口，
 * 避免乐观更新与磁盘真相漂移。同时刷新快速打开 files 快照（FILE-03，补 02-06 carry-forward）。
 */
export async function refreshTree(): Promise<void> {
  const vault = useVaultStore.getState().vault;
  if (!vault) return;
  try {
    const entries = await listDir(vault.root, '');
    useVaultStore.getState().setTree(entriesToNodes(entries));
  } catch {
    // 枚举失败不清空已有树（避免误删视图）；仅快照刷新尽力而为
  }
  try {
    const files = await listFiles(vault.root);
    useVaultStore.getState().setFiles(files);
  } catch {
    /* 快速打开快照刷新失败不阻断 */
  }
}

/**
 * 按相对路径在单内核打开文件（快速打开 Ctrl+P 选中入口，FILE-03）。
 *
 * 复用点击文件树的打开链路：快照当前 → readFile → openFile 换装 → openTab/setActive。
 * 文件名取相对路径 basename（与文件树 node.name 同义）。无 vault / 无 view（未挂载）静默返回。
 */
export async function openFileByPath(path: string): Promise<void> {
  const view = getView();
  const name = path.split('/').pop() ?? path;
  if (!view) return;
  await openFileInEditor(view, { id: path, name, isDir: false });
}

/**
 * 「打开文件夹」命令入口（命令面板 / 空态按钮触发）。
 *
 * 原生文件夹选择对话框尚未接入（拒引未审计 tauri-plugin-dialog，记为 02-03 待办）。
 * 本阶段端到端路径经 openVaultByPath（测试注入 / 后续原生 picker 回填）驱动；
 * 此入口在原生 picker 落地前给出明确提示，不静默吞掉用户操作。
 */
export async function requestOpenFolder(): Promise<void> {
  showToast('warning', '原生文件夹选择将在后续切片接入；当前可经测试或编程入口打开工作区。');
}

/** 点击文件树文件：快照当前 → readFile → openFile 换装 → openTab/setActive。 */
export async function openFileInEditor(view: EditorView, node: TreeNode): Promise<void> {
  const vault = useVaultStore.getState().vault;
  if (!vault || node.isDir) return;
  const active = useEditorStore.getState().activePath;
  if (active) snapshotBeforeSwitch(view, active);
  try {
    const doc = await readFile(vault.root, node.id);
    // 初始语言：frontmatter `language:` 优先于扩展名（D-13 文档单一真相源，EDIT-05），
    // 否则按扩展名解析（.py/.rs/.css 即得高亮，EDIT-04）。
    const lang = languageFromDoc(doc, node.id);
    openFile(view, node.id, doc, baseExtensions(lang));
    markAppliedLanguage(view, lang);
    useEditorStore.getState().openTab({ path: node.id, name: node.name });
    useEditorStore.getState().setActive(node.id);
  } catch {
    showToast('error', `无法读取「${node.name}」，文件可能已被删除或没有访问权限。`);
  }
}
