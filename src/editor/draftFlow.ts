import { pickSavePath } from '../ipc/dialog';
import { writeFileToPath } from '../ipc/files';
import { showToast } from '../stores/useToastStore';
import { useEditorStore } from '../stores/useEditorStore';
import { useVaultStore } from '../stores/useVaultStore';
import { nextDraft } from './draftPath';
import { disposeState, getDocForPath, openFile, snapshotBeforeSwitch } from './editorState';
import { baseExtensions } from './extensions';
import { openFileByPath } from './fileOpenFlow';
import { refreshTree } from './fileTreeData';
import { parentDir, relativeWithinVault, switchVault } from './vaultFlow';
import { getView } from './viewHandle';

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
  const view = getView();
  if (!view) return;
  const active = useEditorStore.getState().activePath;
  if (active) snapshotBeforeSwitch(view, active);
  const draft = nextDraft();
  openFile(view, draft.path, '', baseExtensions('markdown'));
  useEditorStore.getState().openTab(draft);
  useEditorStore.getState().setActive(draft.path);
}

/**
 * 草稿另存为：原生保存对话框 → 绝对路径原子写 → 迁移为普通文件 tab。
 *
 * path 来自原生对话框，属用户显式授权边界，Rust 侧不经 vault path_guard（write_file_to_path）。
 * 取消对话框 no-op（草稿保留）；写失败 toast + 草稿保留。写成功后：
 * - 位置在当前 vault 内 → 按相对路径打开（复用单内核换装链路）+ refreshTree；
 * - vault 外（或无 vault）→ 切其父目录为 vault 后按文件名打开（与「打开文件」同约定）。
 * 真实文件 tab 激活后才关草稿 tab + disposeState（先开后关：快照永不串 path）。
 */
export async function saveDraftAs(draftPath: string): Promise<void> {
  const content = getDocForPath(draftPath);
  if (content === null) return;
  const tab = useEditorStore.getState().tabs.find((t) => t.path === draftPath);
  const absPath = await pickSavePath(`${tab?.name ?? '未命名'}.md`);
  if (absPath === null) return; // 取消：草稿保留
  try {
    await writeFileToPath(absPath, content);
  } catch {
    showToast('error', '保存失败，草稿内容仍保留在编辑器中。');
    return;
  }
  const root = useVaultStore.getState().vault?.root ?? null;
  const rel = root !== null ? relativeWithinVault(absPath, root) : null;
  if (rel !== null) {
    await openFileByPath(rel);
    void refreshTree();
  } else {
    try {
      await switchVault(parentDir(absPath), { confirmLeave: false }); // 另存为转正：不提示提交旧库
    } catch {
      return; // 切 vault 失败（已弹 toast）：内容已落盘，草稿保留供重试
    }
    await openFileByPath(fileName(absPath));
  }
  disposeState(draftPath);
  useEditorStore.getState().closeTab(draftPath);
}
