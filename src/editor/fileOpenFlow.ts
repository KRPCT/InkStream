import type { EditorView } from '@codemirror/view';
import { readFile } from '../ipc/files';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { TreeNode } from '../types/vault';
import { baseExtensions } from './extensions';
import { openFile, snapshotBeforeSwitch } from './editorState';
import { languageFromDoc, markAppliedLanguage } from './languages';
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
