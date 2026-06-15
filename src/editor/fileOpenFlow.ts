import type { EditorView } from '@codemirror/view';
import { readFile } from '../ipc/files';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { TreeNode } from '../types/vault';
import { baseExtensions } from './extensions';
import { openFile, snapshotBeforeSwitch, switchToTab } from './editorState';
import { languageFromDoc, markAppliedLanguage } from './languages';
import { basename, parentDir, relativeWithin, stripVerbatim } from './pathUtil';
import { getView } from './viewHandle';

/**
 * 文件打开编排（从 vaultFlow 析出，289 行超限拆分）。
 *
 * 复用单内核换装链路：快照当前 → readFile → openFile 换装（经 editorState swapState 过门，组合期排队）
 * → openTab/setActive。非 React 模块，经 getState() 读 vault 根（同 vaultFlow / 命令副作用纪律）。
 */

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

/**
 * 按相对路径在单内核打开文件（快速打开 Ctrl+P 选中入口，FILE-03）。
 *
 * 复用点击文件树的打开链路（openFileInEditor）。文件名取相对路径 basename（与文件树 node.name
 * 同义）。无 vault / 无 view（未挂载）静默返回。
 */
export async function openFileByPath(path: string): Promise<void> {
  const view = getView();
  const name = path.split('/').pop() ?? path;
  if (!view) return;
  await openFileInEditor(view, { id: path, name, isDir: false });
}

/**
 * 打开一个绝对路径文件——**不切换工作区**（#5.1）。库外文件成为 external tab（绝对键 + 标记 + git 排除）。
 *
 * - 该绝对路径其实落在当前 vault 内 → 转相对路径走库内打开（openFileByPath），不产生 external tab；
 * - 已打开同一 external tab → 直接切过去（不重读）；
 * - 否则读盘（readFile(父目录, 文件名)：path_guard 对直接子文件天然通过）→ openFile 换装 → 开 external tab。
 *
 * 命令面板「打开文件」选中库外文件、拖拽/「打开方式」（#6）均经此或 vaultFlow.openAbsoluteFile 汇入。
 */
export async function openExternalFile(absPath: string): Promise<void> {
  const view = getView();
  if (!view) return;
  const norm = stripVerbatim(absPath); // 干净形绝对键（去 Windows \\?\），与 readFile/写盘/relativeWithin 一致。
  // 其实在当前 vault 内 → 库内相对打开（不产生 external tab）。
  const root = useVaultStore.getState().vault?.root ?? null;
  if (root) {
    const rel = relativeWithin(norm, root);
    if (rel !== null) {
      await openFileByPath(rel);
      return;
    }
  }
  // 已开同一 external tab → 直接切过去。
  if (useEditorStore.getState().tabs.some((t) => t.path === norm)) {
    switchToTab(norm);
    return;
  }
  const active = useEditorStore.getState().activePath;
  if (active) snapshotBeforeSwitch(view, active);
  const name = basename(norm);
  try {
    const doc = await readFile(parentDir(norm), name); // 绝对读：父目录作 root、文件名作 rel。
    const lang = languageFromDoc(doc, norm);
    openFile(view, norm, doc, baseExtensions(lang));
    markAppliedLanguage(view, lang);
    useEditorStore.getState().openTab({ path: norm, name, external: true });
    useEditorStore.getState().setActive(norm);
  } catch {
    showToast('error', `无法打开「${name}」，文件可能不存在或没有访问权限。`);
  }
}
