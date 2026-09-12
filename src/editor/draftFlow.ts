import { pickSavePath } from '../ipc/dialog';
import { writeFileToPath } from '../ipc/files';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { nextDraft } from './draftPath';
import { getDocForPath, openFile, reapplyImageContext, rekeyState, snapshotBeforeSwitch } from './editorState';
import { baseExtensions } from './extensions';
import { queueAfterComposition } from './composition';
import { scheduleAutosave } from '../stores/autosave';
import { stripVerbatim } from './pathUtil';
import { refreshTree } from './fileTreeData';
import { relativeWithinVault } from './vaultFlow';
import { getView } from './viewHandle';
import { getCommandView } from './commandView';

/**
 * 草稿文档编排：新建（file.new-document）与另存为转正（Ctrl+S 的 draft 分支）。
 *
 * 「打开 app 就能写」：无论有无 vault，新建草稿即开一个空 markdown tab 直接打字；
 * 保存时才经原生保存对话框选真实位置（绝对路径原子写），随后迁移为普通文件 tab。
 */

/** 取绝对路径末段文件名（分隔统一 `/`）。 */
function fileName(absPath: string): string {
  return absPath.replace(/\\/g, '/').split('/').pop() ?? absPath;
}

/**
 * 新建草稿：分配 draft path → 空 markdown 文档换装（可打字 + Live Preview）→ openTab + setActive。
 * 不依赖 vault / 文件树（解「无 vault 无法新建」阻塞）。无 view（未挂载）静默 no-op。
 */
export function newDraftDocument(): void {
  const view = getCommandView();
  if (!view) return;
  const active = useEditorStore.getState().activePath;
  if (active) snapshotBeforeSwitch(view, active);
  const draft = nextDraft();
  useEditorStore.getState().openTab(draft);
  void openFile(view, draft.path, '', baseExtensions('markdown'));
}

/**
 * 草稿另存为：原生保存对话框 → 绝对路径原子写 → 迁移为普通文件 tab。
 *
 * path 来自原生对话框，属用户显式授权边界，Rust 侧不经 vault path_guard（write_file_to_path）。
 * 取消对话框 no-op（草稿保留）；写失败 toast + 草稿保留。写成功后：
 * - 位置在当前 vault 内 → 按相对路径打开（复用单内核换装链路）+ refreshTree；
 * - vault 外（或无 vault）→ 保持当前项目，以绝对路径作为外部文件打开。
 * 真实文件 tab 激活后才关草稿 tab + disposeState（先开后关：快照永不串 path）。
 */
export async function saveDraftAs(draftPath: string): Promise<void> {
  const tab = useEditorStore.getState().tabs.find((t) => t.path === draftPath);
  if (!tab) return;
  const suggestedName = draftPath.includes('/', 'draft://'.length) ? fileName(draftPath) : `${tab.name}.md`;
  const absPath = await pickSavePath(suggestedName);
  if (absPath === null) return; // 取消：草稿保留
  if (!useEditorStore.getState().tabs.includes(tab)) return;
  const content = getDocForPath(draftPath);
  if (content === null) return;
  const initialRoot = useVaultStore.getState().vault?.root ?? null;
  const relative = initialRoot ? relativeWithinVault(absPath, initialRoot) : null;
  const target = relative ?? stripVerbatim(absPath);
  if (useEditorStore.getState().tabs.some((item) => item.path === target && item !== tab)) {
    showToast('error', '目标文件已在编辑器中打开，请先关闭它或选择其他保存位置。');
    return;
  }
  try {
    await writeFileToPath(absPath, content);
  } catch {
    showToast('error', '保存失败，草稿内容仍保留在编辑器中。');
    return;
  }
  const finalize = () => {
    if (!useEditorStore.getState().tabs.includes(tab)) return;
    const currentRoot = useVaultStore.getState().vault?.root ?? null;
    const key = currentRoot ? relativeWithinVault(absPath, currentRoot) : null;
    const savedPath = key ?? stripVerbatim(absPath);
    if (useEditorStore.getState().tabs.some((item) => item.path === savedPath && item !== tab)) {
      showToast('warning', '文件已保存，但目标文件已另行打开；草稿与目标编辑内容均已保留。');
      return;
    }
    const view = getView();
    if (view && useEditorStore.getState().activePath === draftPath) snapshotBeforeSwitch(view, draftPath);
    rekeyState(draftPath, savedPath);
    useEditorStore.getState().rehomeTab(draftPath, savedPath, key === null, fileName(absPath));
    reapplyImageContext(savedPath);
    if (getDocForPath(savedPath) === content) useEditorStore.getState().clearDirty(savedPath);
    else { useEditorStore.getState().markDirty(savedPath); scheduleAutosave(savedPath); }
    void refreshTree();
  };
  const view = getView();
  if (view) await new Promise<void>((resolve) => queueAfterComposition(view, 'save-as:' + draftPath, () => { finalize(); resolve(); }));
  else finalize();
}
