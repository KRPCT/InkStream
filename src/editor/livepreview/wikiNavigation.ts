import { createFile } from '../../ipc/files';
import { confirmDestructive, useConfirmStore } from '../../stores/useConfirmStore';
import { useEditorStore } from '../../stores/useEditorStore';
import { useVaultStore } from '../../stores/useVaultStore';
import { showToast } from '../../stores/useToastStore';
import { openFileAndLocate, openFileByPath } from '../fileOpenFlow';
import { refreshTree } from '../fileTreeData';
import { getView } from '../viewHandle';
import { findWikiAnchor } from './wikiAnchor';
import { parseWikiTarget, wikiTargetCandidates, wikiTargetToCreatePath, type WikiTarget } from './wikiTarget';

async function openTarget(path: string, target: WikiTarget): Promise<void> {
  if (!target.heading && !target.block) {
    await openFileByPath(path);
    return;
  }
  await openFileAndLocate(path, (state) => {
    const result = findWikiAnchor(state, target);
    if (result.kind === 'found') return { from: result.from, to: result.to };
    if (result.kind === 'not-ready') {
      showToast('warning', '文档结构尚未就绪，请稍后重试链接定位。');
    } else {
      const label = result.anchor === 'heading' ? '标题' : '块标识';
      showToast('warning', result.kind === 'missing'
        ? `未找到${label}「${result.label}」，已保留文档当前的位置。`
        : `${label}「${result.label}」不唯一，请使用可区分的目标。`);
    }
    return null;
  });
}

/** Wiki gesture entry: resolve identity, then let the document-opening boundary admit location. */
export async function navigateWikiTarget(raw: string): Promise<void> {
  const target = parseWikiTarget(raw);
  const sourcePath = useEditorStore.getState().activePath;
  const sourceView = getView();
  if (!target.path) {
    if (sourcePath && (target.heading || target.block)) await openTarget(sourcePath, target);
    else showToast('warning', '无法解析该 wiki 链接的目标。');
    return;
  }
  const { vault, files } = useVaultStore.getState();
  if (!vault) return;
  const createPath = wikiTargetToCreatePath(target.path);
  if (createPath === null) {
    showToast('warning', '该 wiki 链接不是有效的工作区内相对路径。');
    return;
  }
  const candidates = wikiTargetCandidates(target.path, files);
  if (candidates.length > 1) {
    showToast('warning', `「${target.path}」有多个同名目标，请补全目录路径。`);
    return;
  }
  if (candidates.length === 1) {
    await openTarget(candidates[0], target);
    return;
  }
  // A modal already owns user input; do not replace its unresolved request with another one.
  if (useConfirmStore.getState().request) return;
  const accepted = await confirmDestructive({
    title: '创建链接目标',
    body: `「${createPath}」尚不存在。创建一个空白 Markdown 文档？`,
    confirmLabel: '创建并打开',
  });
  const stillCurrent = () => useVaultStore.getState().vault === vault
    && useEditorStore.getState().activePath === sourcePath && getView() === sourceView;
  if (!accepted || !stillCurrent()) return;
  try {
    await createFile(vault.root, createPath);
    if (!stillCurrent()) return;
    await openTarget(createPath, target);
    if (useVaultStore.getState().vault === vault) void refreshTree();
  } catch {
    if (useVaultStore.getState().vault === vault) showToast('error', `无法新建「${createPath}」（目标目录可能不存在）。`);
  }
}
