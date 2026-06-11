import type { EditorView } from '@codemirror/view';
import { readFile } from '../ipc/files';
import { listDir, openVault } from '../ipc/vault';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { TreeEntry, TreeNode } from '../types/vault';
import { baseExtensions } from './extensions';
import { languageForPath } from './languages';
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

/** 打开给定路径为 vault：openVault + listDir 根目录 → useVaultStore.openVault。 */
export async function openVaultByPath(path: string): Promise<void> {
  try {
    const info = await openVault(path);
    const entries = await listDir(info.root, '');
    useVaultStore.getState().openVault(info, entriesToNodes(entries));
  } catch (e) {
    showToast('error', '无法打开这个文件夹，它可能已被移动或删除。');
    throw e instanceof Error ? e : new Error(String(e));
  }
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
    // 按扩展名解析初始语言，使打开 .py/.rs/.css 等文件即得对应高亮（EDIT-04）。
    openFile(view, node.id, doc, baseExtensions(languageForPath(node.id)));
    useEditorStore.getState().openTab({ path: node.id, name: node.name });
    useEditorStore.getState().setActive(node.id);
  } catch {
    showToast('error', `无法读取「${node.name}」，文件可能已被删除或没有访问权限。`);
  }
}
