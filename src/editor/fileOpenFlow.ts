import type { EditorView } from '@codemirror/view';
import type { EditorState } from '@codemirror/state';
import { beginDocumentNavigation, documentNavigationSignal, isCurrentDocumentNavigation } from './editorState.navigation';
import { readFile } from '../ipc/files';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import type { TreeNode } from '../types/vault';
import { baseExtensions } from './extensions';
import { openFile, snapshotBeforeSwitch, switchToTab } from './editorState';
import { initialLanguageForDocument } from './languages';
import { basename, parentDir, relativeWithin, stripVerbatim } from './pathUtil';
import { getView, revealRange } from './viewHandle';

function readFailure(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : '读取失败，请检查文件是否可访问。';
}

/**
 * 文件打开编排（从 vaultFlow 析出，289 行超限拆分）。
 *
 * 复用单内核换装链路：快照当前 → readFile → openFile 换装（经 editorState swapState 过门，组合期排队）
 * → openTab/setActive。非 React 模块，经 getState() 读 vault 根（同 vaultFlow / 命令副作用纪律）。
 */

/** 点击文件树文件：快照当前 → readFile → openFile 换装 → openTab/setActive。 */
export async function openFileInEditor(view: EditorView, node: TreeNode, request = beginDocumentNavigation()): Promise<void> {
  const vault = useVaultStore.getState().vault;
  if (!vault || node.isDir) return;
  const active = useEditorStore.getState().activePath;
  if (active) snapshotBeforeSwitch(view, active);
  try {
    const doc = await readFile(vault.root, node.id, { signal: documentNavigationSignal(request) });
    if (!isCurrentDocumentNavigation(request) || useVaultStore.getState().vault !== vault) return;
    // 初始语言：frontmatter `language:` 优先于扩展名（D-13 文档单一真相源，EDIT-05），
    // 否则按扩展名解析（.py/.rs/.css 即得高亮，EDIT-04）。
    const lang = initialLanguageForDocument(doc, node.id);
    useEditorStore.getState().openTab({ path: node.id, name: node.name });
    await openFile(view, node.id, doc, baseExtensions(lang, doc.length), request);
  } catch (error) {
    if (!isCurrentDocumentNavigation(request) || useVaultStore.getState().vault !== vault) return;
    showToast('error', `无法读取「${node.name}」：${readFailure(error)}`);
  }
}

/**
 * 按相对路径在单内核打开文件（快速打开 Ctrl+P 选中入口，FILE-03）。
 *
 * 复用点击文件树的打开链路（openFileInEditor）。文件名取相对路径 basename（与文件树 node.name
 * 同义）。无 vault / 无 view（未挂载）静默返回。
 */
export async function openFileByPath(path: string, request = beginDocumentNavigation()): Promise<void> {
  const view = getView();
  const name = path.split('/').pop() ?? path;
  if (!view) return;
  await openFileInEditor(view, { id: path, name, isDir: false }, request);
}

/** Locate against the accepted document after its scroll restoration, without racing newer navigation. */
export async function openFileAndLocate(path: string, locate: (state: EditorState, signal: AbortSignal) => { from: number; to: number } | null | Promise<{ from: number; to: number } | null>): Promise<boolean> {
  const request = beginDocumentNavigation();
  const vault = useVaultStore.getState().vault;
  if (useEditorStore.getState().activePath !== path) await openFileByPath(path, request);
  const view = getView();
  if (!view || !isCurrentDocumentNavigation(request) || useEditorStore.getState().activePath !== path) return false;
  return new Promise((resolve, reject) => requestAnimationFrame(() => {
    const current = () => getView() === view && vault === useVaultStore.getState().vault && isCurrentDocumentNavigation(request) && useEditorStore.getState().activePath === path;
    if (!current()) return resolve(false);
    const snapshot = view.state;
    const apply = (range: { from: number; to: number } | null) => {
      if (!range || !current() || view.state.doc !== snapshot.doc || !view.state.selection.eq(snapshot.selection)) return resolve(false);
      revealRange(view, range.from, range.to);
      resolve(true);
    };
    try {
      const range = locate(snapshot, documentNavigationSignal(request));
      if (range instanceof Promise) void range.then(apply, (error: unknown) => { if (current()) reject(error); else resolve(false); });
      else apply(range);
    } catch (error) { reject(error); }
  }));
}

/** 正文中定位搜索词首个出现（大小写不敏感，对齐 FTS5 trigram `case_sensitive 0`）；未命中返 -1。 */
export function findMatchOffset(doc: string, term: string): number {
  const t = term.trim();
  if (t === '') return -1;
  return doc.toLowerCase().indexOf(t.toLowerCase());
}

/**
 * 打开文件并跳到指定偏移（全库搜索 multibuffer 选中命中入口，v1.2 #2c）。
 *
 * 与 openFileAndFind 的区别：偏移由调用方在「同一真相源」上算好（命中已在 getDocForPath 内容上定位），
 * 直接选中并滚到该处。跳转排在 openFile 的滚动还原（rAF 回填）之后一帧，否则被覆盖。
 */
export async function openFileAtOffset(path: string, offset: number): Promise<void> {
  await openFileAndLocate(path, (state) => {
    const at = Math.min(Math.max(offset, 0), state.doc.length);
    return { from: at, to: at };
  });
}

/**
 * 打开文件并跳到搜索词首个出现（命令面板 `#` 全文搜索选中入口，v1.2 #2a）。
 *
 * 索引可能滞后于磁盘——故落盘后在「当前文档真相源」上重新定位 term（自校准，复用 v1.1.7 续读锚点纪律）：
 * 命中则选中并滚到该处，未命中（索引陈旧 / 词已删）则停在文首不跳。跳转排在 openFile 的滚动还原
 * （requestAnimationFrame 回填）之后一帧执行，否则定位会被滚动还原覆盖。
 */
export async function openFileAndFind(path: string, term: string): Promise<void> {
  await openFileAndLocate(path, (state) => {
    const at = findMatchOffset(state.doc.toString(), term);
    return at < 0 ? null : { from: at, to: at + term.trim().length };
  });
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
  const request = beginDocumentNavigation();
  const vault = useVaultStore.getState().vault;
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
    await switchToTab(norm);
    return;
  }
  const active = useEditorStore.getState().activePath;
  if (active) snapshotBeforeSwitch(view, active);
  const name = basename(norm);
  try {
    const doc = await readFile(parentDir(norm), name, { signal: documentNavigationSignal(request) });
    if (!isCurrentDocumentNavigation(request) || vault !== useVaultStore.getState().vault) return;
    const lang = initialLanguageForDocument(doc, norm);
    useEditorStore.getState().openTab({ path: norm, name, external: true });
    await openFile(view, norm, doc, baseExtensions(lang, doc.length), request);
  } catch (error) {
    if (!isCurrentDocumentNavigation(request) || vault !== useVaultStore.getState().vault) return;
    showToast('error', `无法打开「${name}」：${readFailure(error)}`);
  }
}
